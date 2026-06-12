// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { GatewayTestBase } from "./GatewayTestBase.t.sol";
import { ArcFXGateway } from "../../src/ArcFXGateway.sol";

contract AdminRecoveryTest is GatewayTestBase {
    bytes32[] _ids;

    function _id(bytes32 g) internal returns (bytes32[] memory) {
        delete _ids;
        _ids.push(g);
        return _ids;
    }

    function test_Recover_RequiresDeactivated() public {
        bytes32 g = _settle(bytes32("inv-1"), 100e6, 100e6);
        vm.warp(block.timestamp + REFUND_WINDOW + ADMIN_RECOVERY_DELAY + 1);

        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSignature("MerchantStillActive(address)", merchant));
        gw.adminRecoverEscrow(_id(g), sweepTo);
    }

    function test_Recover_TooEarly_Reverts() public {
        bytes32 g = _settle(bytes32("inv-2"), 100e6, 100e6);
        vm.prank(merchant); gw.deactivateMerchant();

        // After window but before window + recovery delay
        vm.warp(block.timestamp + REFUND_WINDOW + 1);

        vm.prank(admin);
        vm.expectRevert(); // RecoveryTooEarly
        gw.adminRecoverEscrow(_id(g), sweepTo);
    }

    function test_Recover_HappyPath() public {
        bytes32 g = _settle(bytes32("inv-3"), 100e6, 100e6);
        vm.prank(merchant); gw.deactivateMerchant();
        vm.warp(block.timestamp + REFUND_WINDOW + ADMIN_RECOVERY_DELAY + 1);

        vm.prank(admin);
        gw.adminRecoverEscrow(_id(g), sweepTo);

        assertEq(eurc.balanceOf(sweepTo), 100e6);
        (, , , , , ArcFXGateway.InvoiceStatus s, ) = gw.invoices(g);
        assertEq(uint8(s), uint8(ArcFXGateway.InvoiceStatus.Recovered));
    }

    function test_Recover_OnlyAdmin() public {
        bytes32 g = _settle(bytes32("inv-4"), 100e6, 100e6);
        vm.prank(merchant); gw.deactivateMerchant();
        vm.warp(block.timestamp + REFUND_WINDOW + ADMIN_RECOVERY_DELAY + 1);

        vm.expectRevert();
        gw.adminRecoverEscrow(_id(g), sweepTo);
    }

    function test_Recover_RejectsZeroTo() public {
        bytes32 g = _settle(bytes32("inv-5"), 100e6, 100e6);
        vm.prank(merchant); gw.deactivateMerchant();
        vm.warp(block.timestamp + REFUND_WINDOW + ADMIN_RECOVERY_DELAY + 1);

        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSignature("InvalidPayoutAddress()"));
        gw.adminRecoverEscrow(_id(g), address(0));
    }

    function test_Recover_NonPaidInvoice_Reverts() public {
        // Use an invoice that was refunded (not in Paid state) → InvoiceNotRecoverable
        bytes32 g = _settle(bytes32("inv-6"), 100e6, 100e6);
        vm.prank(merchant); gw.refundInvoice(g);
        vm.prank(merchant); gw.deactivateMerchant();
        vm.warp(block.timestamp + REFUND_WINDOW + ADMIN_RECOVERY_DELAY + 1);

        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSignature("InvoiceNotRecoverable(bytes32)", g));
        gw.adminRecoverEscrow(_id(g), sweepTo);
    }
}
