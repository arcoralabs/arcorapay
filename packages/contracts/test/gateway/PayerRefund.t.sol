// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { GatewayTestBase } from "./GatewayTestBase.t.sol";
import { ArcFXGateway } from "../../src/ArcFXGateway.sol";

contract PayerRefundTest is GatewayTestBase {
    function test_RecordPayerRefund_HappyPath() public {
        bytes32 g = _createInvoice(bytes32("inv-1"), 100e6, 1 hours);

        vm.prank(relayer);
        gw.recordPayerRefund(g, customer, address(usdc), 110e6, bytes32("swap_failed"));

        (, , , , , ArcFXGateway.InvoiceStatus s, ) = gw.invoices(g);
        assertEq(uint8(s), uint8(ArcFXGateway.InvoiceStatus.Failed));
    }

    function test_RecordPayerRefund_OnlyRelayer() public {
        bytes32 g = _createInvoice(bytes32("inv-2"), 100e6, 1 hours);
        vm.expectRevert();
        gw.recordPayerRefund(g, customer, address(usdc), 100e6, bytes32(0));
    }

    function test_RecordPayerRefund_AlreadyPaid_Reverts() public {
        bytes32 g = _settle(bytes32("inv-3"), 100e6, 100e6);
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSignature("InvoiceNotInCreatedState(bytes32)", g));
        gw.recordPayerRefund(g, customer, address(usdc), 100e6, bytes32(0));
    }

    function test_RecordPayerRefund_NotFound_Reverts() public {
        bytes32 ghost = bytes32("never");
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSignature("InvoiceNotFound(bytes32)", ghost));
        gw.recordPayerRefund(ghost, customer, address(usdc), 100e6, bytes32(0));
    }

    function test_RecordPayerRefund_WrongPayInToken_Reverts() public {
        bytes32 g = _createInvoice(bytes32("pr-1"), 100e6, 1 hours);
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSignature("InvalidPayInToken()"));
        gw.recordPayerRefund(g, customer, address(eurc), 100e6, bytes32("r"));
    }
}
