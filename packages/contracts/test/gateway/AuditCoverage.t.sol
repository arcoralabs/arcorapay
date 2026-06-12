// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { GatewayTestBase } from "./GatewayTestBase.t.sol";
import { ArcFXGateway } from "../../src/ArcFXGateway.sol";

/// @notice Coverage for the 4 V10 test gaps surfaced by audit 2026-05-12:
///   - settleInvoice payInToken mismatch (paired with the validation fix #6)
///   - fee math invariant (was in legacy/V9, dropped in the V10 port)
///   - recordPayerRefund respects whenNotPaused
///   - adminRecoverEscrow batch atomicity on mixed-status arrays
contract AuditCoverageTest is GatewayTestBase {
    // -------------------------------------------------------------------------
    // #6 — settleInvoice rejects mismatched payInToken
    // -------------------------------------------------------------------------

    function test_Settle_RejectsPayInTokenMismatch() public {
        // Invoice was created with USDC as payIn (GatewayTestBase helper).
        bytes32 g = _createInvoice(bytes32("mismatch-1"), 100e6, 1 hours);
        _fundRelayer(eurc, 100e6);

        // Relayer claims payInToken = EURC instead — must revert.
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSignature("InvalidPayInToken()"));
        gw.settleInvoice(g, customer, address(eurc), 100e6, 100e6, bytes32(0));

        // Invoice still in Created — no settle happened.
        (, , , , , ArcFXGateway.InvoiceStatus s, ) = gw.invoices(g);
        assertEq(uint8(s), uint8(ArcFXGateway.InvoiceStatus.Created));
        assertEq(gw.protocolFeesAccrued(address(eurc)), 0);
    }

    // -------------------------------------------------------------------------
    // Fee math invariant fuzz
    // -------------------------------------------------------------------------

    /// @notice V13 fee model: settle NEVER touches `protocolFeesAccrued` — the
    /// full grossPayout (amountOut + excess) sits in escrow. The single protocol
    /// fee is taken at claim: `(escrow.amount * FEE_BPS) / 10_000`, with the
    /// remainder (including excess) flowing to the merchant.
    function testFuzz_FeeMath_SingleClaimTimeFee(
        uint256 amountOut1,
        uint256 amountOut2,
        uint256 excess1,
        uint256 excess2
    ) public {
        amountOut1 = bound(amountOut1, 1e6, 1_000_000e6);
        amountOut2 = bound(amountOut2, 1e6, 1_000_000e6);
        excess1    = bound(excess1,    0,   100_000e6);
        excess2    = bound(excess2,    0,   100_000e6);

        uint256 gross1 = amountOut1 + excess1;
        uint256 gross2 = amountOut2 + excess2;

        bytes32 g1 = _createInvoice(bytes32("fuzz-1"), amountOut1, 1 hours);
        _fundRelayer(eurc, gross1);
        vm.prank(relayer);
        gw.settleInvoice(g1, customer, address(usdc), gross1, gross1, bytes32(0));

        bytes32 g2 = _createInvoice(bytes32("fuzz-2"), amountOut2, 1 hours);
        _fundRelayer(eurc, gross2);
        vm.prank(relayer);
        gw.settleInvoice(g2, customer, address(usdc), gross2, gross2, bytes32(0));

        // (a) settle never accrues; (b) escrow holds the full gross.
        assertEq(gw.protocolFeesAccrued(address(eurc)), 0, "settle must not accrue fees");
        (uint256 amt1, , ) = gw.escrows(g1);
        (uint256 amt2, , ) = gw.escrows(g2);
        assertEq(amt1, gross1, "escrow 1 holds grossPayout");
        assertEq(amt2, gross2, "escrow 2 holds grossPayout");

        // (c) claim takes exactly one bps fee on the escrowed gross.
        vm.warp(block.timestamp + REFUND_WINDOW + 1);
        bytes32[] memory ids = new bytes32[](2);
        ids[0] = g1; ids[1] = g2;
        gw.claim(ids);

        uint256 fee1 = (gross1 * FEE_BPS) / 10_000;
        uint256 fee2 = (gross2 * FEE_BPS) / 10_000;
        assertEq(
            gw.protocolFeesAccrued(address(eurc)),
            fee1 + fee2,
            "accrued != sum of single claim-time bps fees"
        );
        assertEq(
            eurc.balanceOf(payee),
            (gross1 - fee1) + (gross2 - fee2),
            "merchant gets full gross (incl. excess) minus one fee per invoice"
        );
    }

    // -------------------------------------------------------------------------
    // recordPayerRefund honors whenNotPaused
    // -------------------------------------------------------------------------

    function test_RecordPayerRefund_RevertsWhenPaused() public {
        bytes32 g = _createInvoice(bytes32("paused-refund"), 100e6, 1 hours);

        vm.prank(admin);
        gw.pause();

        // OZ Pausable revert. Caller is RELAYER_ROLE so the auth check passes
        // — Paused() bubbles from the modifier instead.
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSignature("EnforcedPause()"));
        gw.recordPayerRefund(g, customer, address(usdc), 50e6, bytes32("oracle-stalled"));

        // After unpause the same call succeeds, so the revert is purely from
        // the modifier (not some other path).
        vm.prank(admin);
        gw.unpause();
        vm.prank(relayer);
        gw.recordPayerRefund(g, customer, address(usdc), 50e6, bytes32("oracle-stalled"));
        (, , , , , ArcFXGateway.InvoiceStatus s, ) = gw.invoices(g);
        assertEq(uint8(s), uint8(ArcFXGateway.InvoiceStatus.Failed));
    }

    // -------------------------------------------------------------------------
    // adminRecoverEscrow batch atomicity: one bad row aborts the whole batch
    // -------------------------------------------------------------------------

    function test_AdminRecoverEscrow_MixedStatus_RevertsWholeBatch() public {
        // Two settled invoices for the same (deactivated) merchant.
        bytes32 gPaid     = _settle(bytes32("mix-paid"),     100e6, 100e6);
        bytes32 gRecover  = _settle(bytes32("mix-recover"),  100e6, 100e6);

        vm.prank(merchant);
        gw.deactivateMerchant();

        // Wait out claimableAt + ADMIN_RECOVERY_DELAY.
        vm.warp(block.timestamp + REFUND_WINDOW + ADMIN_RECOVERY_DELAY + 1);

        // Pre-recover one of them legitimately so its status is Recovered.
        bytes32[] memory pre = new bytes32[](1);
        pre[0] = gRecover;
        vm.prank(admin);
        gw.adminRecoverEscrow(pre, sweepTo);

        uint256 sweepBefore = eurc.balanceOf(sweepTo);

        // Now batch: [recovered, paid]. Recovered must abort the call entirely.
        bytes32[] memory mixed = new bytes32[](2);
        mixed[0] = gRecover;     // already Recovered — InvoiceNotRecoverable
        mixed[1] = gPaid;        // would succeed alone, must NOT be touched

        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSignature("InvoiceNotRecoverable(bytes32)", gRecover));
        gw.adminRecoverEscrow(mixed, sweepTo);

        // Atomicity: balance unchanged, gPaid still Paid, its escrow still there.
        assertEq(eurc.balanceOf(sweepTo), sweepBefore, "no partial recovery");
        (, , , , , ArcFXGateway.InvoiceStatus s, ) = gw.invoices(gPaid);
        assertEq(uint8(s), uint8(ArcFXGateway.InvoiceStatus.Paid));
        (uint256 amt, , ) = gw.escrows(gPaid);
        assertEq(amt, 100e6, "gPaid escrow untouched");
    }
}
