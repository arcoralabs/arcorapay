// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { GatewayTestBase } from "./GatewayTestBase.t.sol";
import { ArcFXGateway } from "../../src/ArcFXGateway.sol";

contract SettleTest is GatewayTestBase {
    function test_Settle_CreatesEscrow_NoTransferToMerchant() public {
        bytes32 g = _settle(bytes32("inv-1"), 100e6, 100e6);

        // Funds in custody, NOT in merchant wallet
        assertEq(eurc.balanceOf(payee), 0, "payee receives nothing at settle");
        assertEq(eurc.balanceOf(address(gw)), 100e6, "gateway holds full gross");

        (uint256 amt, address tok, uint64 claimableAt) = gw.escrows(g);
        assertEq(amt, 100e6, "escrow amount = grossPayout (== amountOut here)");
        assertEq(tok, address(eurc));
        assertEq(claimableAt, uint64(block.timestamp + REFUND_WINDOW));

        // Status flipped to Paid
        (, , , , , ArcFXGateway.InvoiceStatus s, address paidBy) = gw.invoices(g);
        assertEq(uint8(s), uint8(ArcFXGateway.InvoiceStatus.Paid));
        assertEq(paidBy, customer);

        // No fee accrued at settle
        assertEq(gw.protocolFeesAccrued(address(eurc)), 0, "fee NOT accrued at settle");
    }

    function test_Settle_ExcessGoesToEscrow_NotFees() public {
        bytes32 g = _settle(bytes32("inv-x1"), 100e6, 105e6);

        (uint256 amt, , ) = gw.escrows(g);
        assertEq(amt, 105e6, "escrow holds the FULL grossPayout (V13 fee model)");
        assertEq(gw.protocolFeesAccrued(address(eurc)), 0, "no fee accrual at settle");
    }

    function test_Settle_ZeroExcess_EscrowEqualsAmountOut() public {
        bytes32 g = _settle(bytes32("inv-x2"), 100e6, 100e6);
        (uint256 amt, , ) = gw.escrows(g);
        assertEq(amt, 100e6);
        assertEq(gw.protocolFeesAccrued(address(eurc)), 0);
    }

    function test_Settle_GrossBelowAmountOut_Reverts() public {
        bytes32 g = _createInvoice(bytes32("inv-3"), 100e6, 1 hours);
        _fundRelayer(eurc, 99e6);
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSignature("PayoutShortfall(uint256,uint256)", 99e6, 100e6));
        gw.settleInvoice(g, customer, address(usdc), 99e6, 99e6, bytes32(0));
    }

    function test_Settle_OnlyRelayer() public {
        bytes32 g = _createInvoice(bytes32("inv-4"), 100e6, 1 hours);
        vm.expectRevert();
        gw.settleInvoice(g, customer, address(usdc), 100e6, 100e6, bytes32(0));
    }

    function test_Settle_DoubleSettle_Reverts() public {
        bytes32 g = _settle(bytes32("inv-5"), 100e6, 100e6);
        _fundRelayer(eurc, 100e6);
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSignature("InvoiceAlreadyPaid(bytes32)", g));
        gw.settleInvoice(g, customer, address(usdc), 100e6, 100e6, bytes32(0));
    }

    function test_Settle_Expired_Reverts() public {
        bytes32 g = _createInvoice(bytes32("inv-6"), 100e6, 1 hours);
        vm.warp(block.timestamp + 2 hours);
        _fundRelayer(eurc, 100e6);
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSignature("InvoiceExpired(bytes32)", g));
        gw.settleInvoice(g, customer, address(usdc), 100e6, 100e6, bytes32(0));
    }

    function test_Settle_NotFound_Reverts() public {
        bytes32 ghost = keccak256(abi.encodePacked("nonexistent"));
        _fundRelayer(eurc, 100e6);
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSignature("InvoiceNotFound(bytes32)", ghost));
        gw.settleInvoice(ghost, customer, address(usdc), 100e6, 100e6, bytes32(0));
    }

    function test_CreateInvoice_ZeroAmount_Reverts() public {
        vm.prank(merchant);
        vm.expectRevert(abi.encodeWithSignature("InvalidAmount()"));
        gw.createInvoice(bytes32("z"), address(usdc), 0, uint64(block.timestamp + 1 hours));
    }
}
