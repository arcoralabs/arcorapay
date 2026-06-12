// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Test }              from "forge-std/Test.sol";
import { Vm }                from "forge-std/Vm.sol";
import { IERC20 }            from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IAccessControl }    from "@openzeppelin/contracts/access/IAccessControl.sol";

import { ArcFXGateway }   from "../../src/ArcFXGateway.sol";
import { MockERC20 }         from "../helpers/MockERC20.sol";

abstract contract GatewayTestBase is Test {
    ArcFXGateway gw;
    MockERC20 usdc;
    MockERC20 eurc;

    address admin    = makeAddr("admin");
    address relayer  = makeAddr("relayer");
    address merchant = makeAddr("merchant");
    address payee    = makeAddr("payee");
    address customer = makeAddr("customer");
    address sweepTo  = makeAddr("sweepTo");

    uint256 constant FEE_BPS              = 30;          // 0.30%
    uint64  constant REFUND_WINDOW        = 7 days;
    uint64  constant ADMIN_RECOVERY_DELAY = 7 days;

    function setUp() public virtual {
        vm.warp(1_700_000_000);

        usdc = new MockERC20("USD Coin", "USDC", 6);
        eurc = new MockERC20("Euro Coin", "EURC", 6);

        gw = new ArcFXGateway(FEE_BPS, REFUND_WINDOW, ADMIN_RECOVERY_DELAY, admin, relayer);

        vm.startPrank(admin);
        gw.setTokenSupport(address(usdc), true);
        gw.setTokenSupport(address(eurc), true);
        vm.stopPrank();

        vm.prank(merchant);
        gw.registerMerchant(payee, address(eurc));
    }

    function _createInvoice(bytes32 invoiceId, uint256 amountOut, uint64 ttl) internal returns (bytes32) {
        vm.prank(merchant);
        return gw.createInvoice(invoiceId, address(usdc), amountOut, uint64(block.timestamp + ttl));
    }

    function _fundRelayer(MockERC20 token, uint256 amount) internal {
        token.mint(relayer, amount);
        vm.prank(relayer);
        token.approve(address(gw), amount);
    }

    function _settle(bytes32 invoiceId, uint256 amountOut, uint256 gross) internal returns (bytes32 globalId) {
        globalId = _createInvoice(invoiceId, amountOut, 1 hours);
        _fundRelayer(eurc, gross);
        vm.prank(relayer);
        gw.settleInvoice(globalId, customer, address(usdc), gross + 10e6, gross, bytes32(0));
    }
}

contract WhitelistAndPauseTest is GatewayTestBase {
    function test_SetTokenSupport_OnlyAdmin() public {
        MockERC20 t = new MockERC20("X", "X", 6);
        vm.expectRevert();
        gw.setTokenSupport(address(t), true);
        vm.prank(admin);
        gw.setTokenSupport(address(t), true);
        assertTrue(gw.supportedTokens(address(t)));
    }

    function test_PauseUnpause_OnlyAdmin() public {
        vm.expectRevert();
        gw.pause();
        vm.prank(admin);
        gw.pause();
        assertTrue(gw.paused());
        vm.prank(admin);
        gw.unpause();
        assertFalse(gw.paused());
    }
}
