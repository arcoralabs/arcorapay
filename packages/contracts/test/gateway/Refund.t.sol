// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { GatewayTestBase } from "./GatewayTestBase.t.sol";
import { ArcFXGateway } from "../../src/ArcFXGateway.sol";

contract RefundTest is GatewayTestBase {
    address delegate = makeAddr("refund-delegate");

    // Cache rights as constants to avoid consuming vm.prank with external view calls
    uint8 constant RIGHT_CI = 1 << 0; // RIGHT_CREATE_INVOICE
    uint8 constant RIGHT_R  = 1 << 1; // RIGHT_REFUND

    function test_Refund_MakesCustomerWhole() public {
        bytes32 g = _settle(bytes32("inv-1"), 100e6, 100e6);

        vm.prank(merchant);
        gw.refundInvoice(g);

        // Customer gets FULL amountOut back (not amountOut - fee like V9)
        assertEq(eurc.balanceOf(customer), 100e6, "customer made whole");
        assertEq(eurc.balanceOf(address(gw)), 0, "escrow drained");
        assertEq(gw.protocolFeesAccrued(address(eurc)), 0, "no fee accrued by settle, none touched by refund");

        (uint256 amt, , ) = gw.escrows(g);
        assertEq(amt, 0, "escrow deleted");

        (, , , , , ArcFXGateway.InvoiceStatus s, ) = gw.invoices(g);
        assertEq(uint8(s), uint8(ArcFXGateway.InvoiceStatus.Refunded));
    }

    function test_Refund_ReturnsFullGross_IncludingExcess() public {
        bytes32 g = _settle(bytes32("inv-2"), 100e6, 105e6);

        vm.prank(merchant);
        gw.refundInvoice(g);

        assertEq(eurc.balanceOf(customer), 105e6, "payer gets the full escrowed gross");
        assertEq(gw.protocolFeesAccrued(address(eurc)), 0, "protocol takes nothing on refund");
    }

    function test_Refund_AfterWindow_Reverts() public {
        bytes32 g = _settle(bytes32("inv-w1"), 100e6, 100e6);
        vm.warp(block.timestamp + REFUND_WINDOW + 1);

        vm.prank(merchant);
        vm.expectRevert(abi.encodeWithSignature("RefundWindowExpired(bytes32)", g));
        gw.refundInvoice(g);
    }

    function test_Refund_AtWindowBoundary_Succeeds() public {
        bytes32 g = _settle(bytes32("inv-w2"), 100e6, 100e6);
        (, , uint64 claimableAt) = gw.escrows(g);
        vm.warp(claimableAt);   // last second of the window

        vm.prank(merchant);
        gw.refundInvoice(g);
        assertEq(eurc.balanceOf(customer), 100e6);
    }

    function test_Refund_AdminCanRefund() public {
        bytes32 g = _settle(bytes32("inv-3"), 100e6, 100e6);
        vm.prank(admin);
        gw.refundInvoice(g);
        assertEq(eurc.balanceOf(customer), 100e6);
    }

    function test_Refund_DelegateWithRefundRight_CanRefund() public {
        bytes32 g = _settle(bytes32("inv-4"), 100e6, 100e6);
        vm.prank(merchant);
        gw.authorizeDelegate(delegate, uint64(block.timestamp + 1 days), RIGHT_R);
        vm.prank(delegate);
        gw.refundInvoice(g);
        assertEq(eurc.balanceOf(customer), 100e6);
    }

    function test_Refund_DelegateWithoutRefundRight_Reverts() public {
        bytes32 g = _settle(bytes32("inv-5"), 100e6, 100e6);
        vm.prank(merchant);
        gw.authorizeDelegate(delegate, uint64(block.timestamp + 1 days), RIGHT_CI);
        vm.prank(delegate);
        vm.expectRevert(abi.encodeWithSignature("NotAuthorized()"));
        gw.refundInvoice(g);
    }

    function test_Refund_Stranger_Reverts() public {
        bytes32 g = _settle(bytes32("inv-6"), 100e6, 100e6);
        address ghost = makeAddr("ghost");
        vm.prank(ghost);
        vm.expectRevert(abi.encodeWithSignature("NotAuthorized()"));
        gw.refundInvoice(g);
    }

    function test_Refund_NotPaid_Reverts() public {
        bytes32 g = _createInvoice(bytes32("inv-7"), 100e6, 1 hours);
        vm.prank(merchant);
        vm.expectRevert(abi.encodeWithSignature("InvoiceNotRefundable(bytes32)", g));
        gw.refundInvoice(g);
    }

    function test_Refund_WorksDuringPause() public {
        bytes32 g = _settle(bytes32("inv-8"), 100e6, 100e6);
        vm.prank(admin);
        gw.pause();
        vm.prank(merchant);
        gw.refundInvoice(g);
        assertEq(eurc.balanceOf(customer), 100e6, "refund must work when paused");
    }
}
