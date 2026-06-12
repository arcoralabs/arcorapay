// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { IERC20 }            from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 }         from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { AccessControl }     from "@openzeppelin/contracts/access/AccessControl.sol";
import { ReentrancyGuard }   from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { Pausable }          from "@openzeppelin/contracts/utils/Pausable.sol";

/// @title ArcFXGateway
/// @notice Custody gateway. Settled funds are held in per-invoice escrow;
///         refunds within the 7-day window pull from escrow (no allowance);
///         after the window, anyone may call claim() to push the merchant
///         leg out (fee accrued at claim, NOT at settle); deactivated
///         merchants' escrow becomes admin-recoverable after a further
///         7 days. Closes audit residuals H4 (custody), M3 (fee bound),
///         M4 (reactivate semantics), L2 (nonReentrant on PayerRefund).
contract ArcFXGateway is AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");
    uint8   public constant RIGHT_CREATE_INVOICE = 1 << 0;
    uint8   public constant RIGHT_REFUND         = 1 << 1;

    uint256 public immutable PROTOCOL_FEE_BPS;
    uint64  public immutable REFUND_WINDOW;
    uint64  public immutable ADMIN_RECOVERY_DELAY;

    mapping(address token    => bool)     public supportedTokens;

    struct Merchant { address payoutAddress; address payoutToken; bool active; }
    mapping(address merchant => Merchant) public merchants;

    enum InvoiceStatus { None, Created, Paid, Refunded, Failed, Claimed, Recovered }
    struct Invoice {
        address       merchant;
        address       payIn;
        address       payoutToken;
        uint256       amountOut;
        uint64        expiresAt;
        InvoiceStatus status;
        address       paidBy;
    }
    mapping(bytes32 globalId => Invoice) public invoices;

    struct Escrow { uint256 amount; address payoutToken; uint64 claimableAt; }
    mapping(bytes32 globalId => Escrow) public escrows;

    mapping(address token    => uint256) public protocolFeesAccrued;

    struct DelegateAuth { uint64 expiresAt; uint8 rights; }
    mapping(address merchant => mapping(address delegate => DelegateAuth)) public delegates;

    error InvalidPayoutAddress();
    error InvalidWindow();
    error ProtocolFeeTooHigh(uint256 supplied);
    error NoFeesToWithdraw();

    constructor(
        uint256 protocolFeeBps,
        uint64  refundWindow,
        uint64  adminRecoveryDelay,
        address initialOwner,
        address initialRelayer
    ) {
        if (initialOwner   == address(0)) revert InvalidPayoutAddress();
        if (initialRelayer == address(0)) revert InvalidPayoutAddress();
        if (protocolFeeBps > 1_000)       revert ProtocolFeeTooHigh(protocolFeeBps);
        if (refundWindow == 0)            revert InvalidWindow();
        if (adminRecoveryDelay == 0)      revert InvalidWindow();

        PROTOCOL_FEE_BPS     = protocolFeeBps;
        REFUND_WINDOW        = refundWindow;
        ADMIN_RECOVERY_DELAY = adminRecoveryDelay;

        _grantRole(DEFAULT_ADMIN_ROLE, initialOwner);
        _grantRole(RELAYER_ROLE,       initialRelayer);
    }

    // =========================================================================
    // Task 4: Token whitelist + pause
    // =========================================================================

    event TokenSupportUpdated(address indexed token, bool active);

    function setTokenSupport(address token, bool active) external onlyRole(DEFAULT_ADMIN_ROLE) {
        supportedTokens[token] = active;
        emit TokenSupportUpdated(token, active);
    }

    function pause()   external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }

    // =========================================================================
    // Task 5: Merchant lifecycle
    // =========================================================================

    error NotMerchant();
    error MerchantAlreadyRegistered();
    error MerchantAlreadyActive();
    error MerchantInactive();
    error InvalidPayoutToken();

    event MerchantRegistered(address indexed merchant, address payoutAddress, address payoutToken);
    event MerchantPayoutAddressUpdated(address indexed merchant, address oldAddress, address newAddress);
    event MerchantPayoutTokenUpdated(address indexed merchant, address oldToken, address newToken);
    event MerchantDeactivated(address indexed merchant);
    event MerchantReactivated(address indexed merchant);

    function registerMerchant(address payoutAddress, address payoutToken) external {
        // M4: reject any pre-existing row, active or not. Reactivation is admin-gated.
        if (merchants[msg.sender].payoutAddress != address(0)) revert MerchantAlreadyRegistered();
        if (payoutAddress == address(0))                       revert InvalidPayoutAddress();
        if (!supportedTokens[payoutToken])                     revert InvalidPayoutToken();
        merchants[msg.sender] = Merchant({
            payoutAddress: payoutAddress,
            payoutToken:   payoutToken,
            active:        true
        });
        emit MerchantRegistered(msg.sender, payoutAddress, payoutToken);
    }

    function updatePayoutAddress(address newPayoutAddress) external {
        Merchant storage m = merchants[msg.sender];
        if (!m.active)                       revert NotMerchant();
        if (newPayoutAddress == address(0))  revert InvalidPayoutAddress();
        address old = m.payoutAddress;
        m.payoutAddress = newPayoutAddress;
        emit MerchantPayoutAddressUpdated(msg.sender, old, newPayoutAddress);
    }

    function updatePayoutToken(address newPayoutToken) external {
        Merchant storage m = merchants[msg.sender];
        if (!m.active)                          revert NotMerchant();
        if (!supportedTokens[newPayoutToken])   revert InvalidPayoutToken();
        address old = m.payoutToken;
        m.payoutToken = newPayoutToken;
        emit MerchantPayoutTokenUpdated(msg.sender, old, newPayoutToken);
    }

    function deactivateMerchant() external {
        Merchant storage m = merchants[msg.sender];
        if (!m.active) revert NotMerchant();
        m.active = false;
        emit MerchantDeactivated(msg.sender);
    }

    /// @notice Admin-only reactivation (audit M4). Preserves payoutAddress/Token.
    function reactivateMerchant(address merchantAddr) external onlyRole(DEFAULT_ADMIN_ROLE) {
        Merchant storage m = merchants[merchantAddr];
        if (m.payoutAddress == address(0)) revert NotMerchant();
        if (m.active)                       revert MerchantAlreadyActive();
        m.active = true;
        emit MerchantReactivated(merchantAddr);
    }

    // =========================================================================
    // Task 6: Invoice creation + delegate scope
    // =========================================================================

    error InvalidPayInToken();
    error InvoiceAlreadyExists(bytes32 globalId);
    error DelegateNotAuthorized();
    error InvalidDelegateRights(uint8 rights);
    error InvalidDelegateExpiry();
    error InvalidAmount();

    event InvoiceCreated(
        bytes32 indexed globalId,
        address indexed merchant,
        bytes32 indexed merchantInvoiceId,
        address payIn,
        address payoutToken,
        uint256 amountOut,
        uint64 expiresAt
    );
    event DelegateAuthorized(address indexed merchant, address indexed delegate, uint64 expiresAt, uint8 rights);
    event DelegateRevoked(address indexed merchant, address indexed delegate);

    function createInvoice(
        bytes32 merchantInvoiceId,
        address payIn,
        uint256 amountOut,
        uint64  expiresAt
    ) external returns (bytes32) {
        return _createInvoice(msg.sender, merchantInvoiceId, payIn, amountOut, expiresAt);
    }

    function createInvoiceFor(
        address merchant_,
        bytes32 merchantInvoiceId,
        address payIn,
        uint256 amountOut,
        uint64  expiresAt
    ) external returns (bytes32) {
        DelegateAuth memory d = delegates[merchant_][msg.sender];
        if (block.timestamp > d.expiresAt)               revert DelegateNotAuthorized();
        if ((d.rights & RIGHT_CREATE_INVOICE) == 0)      revert DelegateNotAuthorized();
        return _createInvoice(merchant_, merchantInvoiceId, payIn, amountOut, expiresAt);
    }

    function _createInvoice(
        address merchant_,
        bytes32 merchantInvoiceId,
        address payIn,
        uint256 amountOut,
        uint64  expiresAt
    ) internal whenNotPaused returns (bytes32 globalId) {
        if (amountOut == 0) revert InvalidAmount();
        Merchant memory m = merchants[merchant_];
        if (!m.active)                revert MerchantInactive();
        if (!supportedTokens[payIn])  revert InvalidPayInToken();

        globalId = keccak256(abi.encode(merchant_, merchantInvoiceId));
        if (invoices[globalId].status != InvoiceStatus.None) revert InvoiceAlreadyExists(globalId);

        invoices[globalId] = Invoice({
            merchant:    merchant_,
            payIn:       payIn,
            payoutToken: m.payoutToken,
            amountOut:   amountOut,
            expiresAt:   expiresAt,
            status:      InvoiceStatus.Created,
            paidBy:      address(0)
        });
        emit InvoiceCreated(globalId, merchant_, merchantInvoiceId, payIn, m.payoutToken, amountOut, expiresAt);
    }

    function authorizeDelegate(address delegate, uint64 expiresAt, uint8 rights) external {
        if (!merchants[msg.sender].active) revert NotMerchant();
        uint8 validMask = RIGHT_CREATE_INVOICE | RIGHT_REFUND;
        if ((rights & ~validMask) != 0)    revert InvalidDelegateRights(rights);
        if (expiresAt <= block.timestamp)  revert InvalidDelegateExpiry();
        delegates[msg.sender][delegate] = DelegateAuth({ expiresAt: expiresAt, rights: rights });
        emit DelegateAuthorized(msg.sender, delegate, expiresAt, rights);
    }

    function revokeDelegate(address delegate) external {
        delete delegates[msg.sender][delegate];
        emit DelegateRevoked(msg.sender, delegate);
    }

    // =========================================================================
    // Task 7: Settle invoice → custody escrow
    // =========================================================================

    error InvoiceAlreadyPaid(bytes32 globalId);
    error InvoiceExpired(bytes32 globalId);
    error InvoiceNotFound(bytes32 globalId);
    error InvoiceNotInCreatedState(bytes32 globalId);
    error PayoutShortfall(uint256 supplied, uint256 required);

    event InvoicePaid(
        bytes32 indexed globalId,
        address indexed payer,
        uint256 amountIn,
        uint256 grossReceived,
        uint256 invoiceAmountOut,
        uint256 excessToEscrow
    );
    event SettlementContext(bytes32 indexed globalId, address indexed payInToken, bytes32 swapTxHash);
    event EscrowCreated(bytes32 indexed globalId, address indexed payoutToken, uint256 amount, uint64 claimableAt);

    function settleInvoice(
        bytes32 globalId,
        address payer,
        address payInToken,
        uint256 amountIn,
        uint256 grossPayout,
        bytes32 swapTxHash
    ) external nonReentrant whenNotPaused onlyRole(RELAYER_ROLE) {
        Invoice storage inv = invoices[globalId];
        if (inv.status == InvoiceStatus.None)        revert InvoiceNotFound(globalId);
        if (inv.status != InvoiceStatus.Created)     revert InvoiceAlreadyPaid(globalId);
        if (block.timestamp > inv.expiresAt)         revert InvoiceExpired(globalId);
        if (payInToken != inv.payIn)                 revert InvalidPayInToken();
        if (grossPayout < inv.amountOut)             revert PayoutShortfall(grossPayout, inv.amountOut);

        address payoutToken = inv.payoutToken;
        IERC20(payoutToken).safeTransferFrom(msg.sender, address(this), grossPayout);

        // V13 fee model: the protocol fee is taken ONLY at claim (PROTOCOL_FEE_BPS
        // on the escrowed amount). Any settlement excess (grossPayout - amountOut)
        // stays in escrow and flows to the merchant at claim / to the payer on
        // refund. Audit 2026-06-11 H1 (double fee accrual).
        // informational only — escrow holds grossPayout; this value just feeds the event
        uint256 excessToEscrow = grossPayout - inv.amountOut;
        uint64  claimableAt    = uint64(block.timestamp) + REFUND_WINDOW;

        escrows[globalId] = Escrow({
            amount:      grossPayout,
            payoutToken: payoutToken,
            claimableAt: claimableAt
        });

        inv.status = InvoiceStatus.Paid;
        inv.paidBy = payer;

        // Last event arg historically carried the settle-time protocol fee; in
        // V13 it reports the excess routed to escrow (param renamed — same ABI).
        emit InvoicePaid(globalId, payer, amountIn, grossPayout, inv.amountOut, excessToEscrow);
        emit SettlementContext(globalId, payInToken, swapTxHash);
        emit EscrowCreated(globalId, payoutToken, grossPayout, claimableAt);
    }

    // =========================================================================
    // Task 8: Refund — full escrowed gross to payer, no fee accrual,
    // only within REFUND_WINDOW (V13)
    // =========================================================================

    error NotAuthorized();
    error InvoiceNotRefundable(bytes32 globalId);
    error RefundWindowExpired(bytes32 globalId);

    event InvoiceRefunded(
        bytes32 indexed globalId,
        address indexed refundedTo,
        address indexed payoutToken,
        uint256 refundAmount,
        uint256 protocolFeeReturned
    );

    /// @dev Intentionally omits whenNotPaused — refunds must remain callable
    /// during pause (matches V9 design).
    /// @dev At block.timestamp == claimableAt both refundInvoice and claim are
    /// valid; whichever lands first wins. Strictly after, only claim.
    function refundInvoice(bytes32 globalId) external nonReentrant {
        Invoice storage inv = invoices[globalId];
        if (inv.status != InvoiceStatus.Paid) revert InvoiceNotRefundable(globalId);

        address merchant_ = inv.merchant;
        DelegateAuth memory d = delegates[merchant_][msg.sender];
        bool isMerchant       = msg.sender == merchant_;
        bool isAdmin          = hasRole(DEFAULT_ADMIN_ROLE, msg.sender);
        bool isRefundDelegate = d.expiresAt >= block.timestamp && (d.rights & RIGHT_REFUND) != 0;
        if (!isMerchant && !isAdmin && !isRefundDelegate) revert NotAuthorized();

        Escrow memory e = escrows[globalId];
        // V13: the 7-day refund guarantee is enforced on-chain. After the
        // window the escrow belongs to the claim path; late refunds happen
        // off-chain from the merchant's own wallet. Audit 2026-06-11 H2.
        if (block.timestamp > e.claimableAt) revert RefundWindowExpired(globalId);
        address refundTo = inv.paidBy;

        inv.status = InvoiceStatus.Refunded;
        delete escrows[globalId];

        IERC20(e.payoutToken).safeTransfer(refundTo, e.amount);

        emit InvoiceRefunded(globalId, refundTo, e.payoutToken, e.amount, /*protocolFeeReturned=*/0);
    }

    // =========================================================================
    // Task 9: Claim — permissionless, fee accrual at claim time
    // =========================================================================

    error InvoiceNotClaimable(bytes32 globalId);
    error ClaimTooEarly(bytes32 globalId, uint64 claimableAt);
    error PayoutAddressUnset(address merchant);

    event InvoiceClaimed(
        bytes32 indexed globalId,
        address indexed merchant,
        address payoutAddress,
        address payoutToken,
        uint256 toMerchant,
        uint256 fee
    );

    /// @notice Permissionless. Funds always route to the current
    /// merchants[merchant].payoutAddress (rotation-safe).
    /// Atomic batch — any failure reverts the entire call.
    function claim(bytes32[] calldata globalIds) external nonReentrant {
        for (uint256 i = 0; i < globalIds.length; ++i) {
            bytes32 globalId = globalIds[i];
            Invoice storage inv = invoices[globalId];
            Escrow memory e = escrows[globalId];

            if (inv.status != InvoiceStatus.Paid)         revert InvoiceNotClaimable(globalId);
            if (block.timestamp < e.claimableAt)          revert ClaimTooEarly(globalId, e.claimableAt);

            address payoutAddress = merchants[inv.merchant].payoutAddress;
            if (payoutAddress == address(0))              revert PayoutAddressUnset(inv.merchant);

            uint256 fee        = (e.amount * PROTOCOL_FEE_BPS) / 10_000;
            uint256 toMerchant = e.amount - fee;

            inv.status = InvoiceStatus.Claimed;
            delete escrows[globalId];
            protocolFeesAccrued[e.payoutToken] += fee;

            IERC20(e.payoutToken).safeTransfer(payoutAddress, toMerchant);

            emit InvoiceClaimed(globalId, inv.merchant, payoutAddress, e.payoutToken, toMerchant, fee);
        }
    }

    // =========================================================================
    // Task 10: Admin recovery for abandoned escrow
    // =========================================================================

    error InvoiceNotRecoverable(bytes32 globalId);
    error MerchantStillActive(address merchant);
    error RecoveryTooEarly(bytes32 globalId, uint64 recoverableAt);

    event EscrowRecovered(
        bytes32 indexed globalId,
        address indexed merchant,
        address payoutToken,
        uint256 amount,
        address to
    );

    function adminRecoverEscrow(bytes32[] calldata globalIds, address to)
        external nonReentrant onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (to == address(0)) revert InvalidPayoutAddress();
        for (uint256 i = 0; i < globalIds.length; ++i) {
            bytes32 globalId = globalIds[i];
            Invoice storage inv = invoices[globalId];
            Escrow memory e = escrows[globalId];

            if (inv.status != InvoiceStatus.Paid)        revert InvoiceNotRecoverable(globalId);
            if (merchants[inv.merchant].active)          revert MerchantStillActive(inv.merchant);
            uint64 recoverableAt = e.claimableAt + ADMIN_RECOVERY_DELAY;
            if (block.timestamp < recoverableAt)         revert RecoveryTooEarly(globalId, recoverableAt);

            inv.status = InvoiceStatus.Recovered;
            delete escrows[globalId];

            IERC20(e.payoutToken).safeTransfer(to, e.amount);

            emit EscrowRecovered(globalId, inv.merchant, e.payoutToken, e.amount, to);
        }
    }

    // =========================================================================
    // Task 11: Failed-swap path (recordPayerRefund) + L2 nonReentrant
    // =========================================================================

    event PayerRefunded(
        bytes32 indexed globalId,
        address indexed payer,
        address payInToken,
        uint256 amount,
        bytes32 reasonHash
    );

    /// @dev L2: nonReentrant added (defensive — no external call in body
    /// today, but guards against silent regressions).
    function recordPayerRefund(
        bytes32 globalId,
        address payer,
        address payInToken,
        uint256 amount,
        bytes32 reasonHash
    ) external nonReentrant whenNotPaused onlyRole(RELAYER_ROLE) {
        Invoice storage inv = invoices[globalId];
        if (inv.status == InvoiceStatus.None)        revert InvoiceNotFound(globalId);
        if (inv.status != InvoiceStatus.Created)     revert InvoiceNotInCreatedState(globalId);
        if (payInToken != inv.payIn)                 revert InvalidPayInToken();

        inv.status = InvoiceStatus.Failed;
        emit PayerRefunded(globalId, payer, payInToken, amount, reasonHash);
    }

    // =========================================================================
    // Task 12: Pause behavior — withdrawFees (the only missing piece)
    // =========================================================================

    event FeesWithdrawn(address indexed token, address indexed to, uint256 amount);

    // Audit #27: nonReentrant for consistency with every other fund-moving
    // path in this contract. The CEI ordering here (zero-before-transfer)
    // already prevents a reentrancy drain, but the missing modifier breaks
    // the invariant and would become a latent vector the day a non-standard
    // ERC20 (fee-on-transfer, hook-equipped) gets whitelisted.
    function withdrawFees(address token, address to) external nonReentrant onlyRole(DEFAULT_ADMIN_ROLE) {
        if (to == address(0)) revert InvalidPayoutAddress();
        uint256 amount = protocolFeesAccrued[token];
        if (amount == 0)      revert NoFeesToWithdraw();
        protocolFeesAccrued[token] = 0;
        IERC20(token).safeTransfer(to, amount);
        emit FeesWithdrawn(token, to, amount);
    }
}
