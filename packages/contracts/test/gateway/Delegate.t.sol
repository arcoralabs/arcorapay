// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { GatewayTestBase } from "./GatewayTestBase.t.sol";
import { ArcFXGateway } from "../../src/ArcFXGateway.sol";

contract DelegateTest is GatewayTestBase {
    address delegate = makeAddr("delegate");

    uint8 constant RIGHT_CI = 1 << 0; // RIGHT_CREATE_INVOICE
    uint8 constant RIGHT_R  = 1 << 1; // RIGHT_REFUND

    function test_CreateInvoice_HappyPath() public {
        vm.prank(merchant);
        bytes32 g = gw.createInvoice(bytes32("inv-1"), address(usdc), 100e6, uint64(block.timestamp + 1 hours));
        (address mer, , , uint256 amt, , ArcFXGateway.InvoiceStatus s, ) = gw.invoices(g);
        assertEq(mer, merchant);
        assertEq(amt, 100e6);
        assertEq(uint8(s), uint8(ArcFXGateway.InvoiceStatus.Created));
    }

    function test_AuthorizeDelegate_RejectsUnknownRights() public {
        vm.prank(merchant);
        // 0x80 = bit beyond CREATE_INVOICE | REFUND
        vm.expectRevert(abi.encodeWithSignature("InvalidDelegateRights(uint8)", uint8(0x80)));
        gw.authorizeDelegate(delegate, uint64(block.timestamp + 1 days), 0x80);
    }

    function test_CreateInvoiceFor_DelegateWithRight_Succeeds() public {
        vm.prank(merchant);
        gw.authorizeDelegate(delegate, uint64(block.timestamp + 1 days), RIGHT_CI);

        vm.prank(delegate);
        bytes32 g = gw.createInvoiceFor(merchant, bytes32("inv-2"), address(usdc), 50e6, uint64(block.timestamp + 1 hours));
        (address mer, , , , , , ) = gw.invoices(g);
        assertEq(mer, merchant);
    }

    function test_CreateInvoiceFor_DelegateWithRefundOnly_Reverts() public {
        vm.prank(merchant);
        gw.authorizeDelegate(delegate, uint64(block.timestamp + 1 days), RIGHT_R);

        vm.prank(delegate);
        vm.expectRevert(abi.encodeWithSignature("DelegateNotAuthorized()"));
        gw.createInvoiceFor(merchant, bytes32("inv-3"), address(usdc), 50e6, uint64(block.timestamp + 1 hours));
    }

    function test_CreateInvoiceFor_ExpiredDelegate_Reverts() public {
        vm.prank(merchant);
        gw.authorizeDelegate(delegate, uint64(block.timestamp + 1 hours), RIGHT_CI);

        vm.warp(block.timestamp + 2 hours);

        vm.prank(delegate);
        vm.expectRevert(abi.encodeWithSignature("DelegateNotAuthorized()"));
        gw.createInvoiceFor(merchant, bytes32("inv-4"), address(usdc), 50e6, uint64(block.timestamp + 1 hours));
    }

    function test_RevokeDelegate() public {
        vm.startPrank(merchant);
        gw.authorizeDelegate(delegate, uint64(block.timestamp + 1 days), RIGHT_CI);
        gw.revokeDelegate(delegate);
        vm.stopPrank();

        (uint64 exp, uint8 rights) = gw.delegates(merchant, delegate);
        assertEq(exp, 0);
        assertEq(rights, 0);
    }

    // --- _createInvoice guard branches ---

    function test_CreateInvoice_InactiveMerchant_Reverts() public {
        vm.prank(merchant);
        gw.deactivateMerchant();
        vm.prank(merchant);
        vm.expectRevert(abi.encodeWithSignature("MerchantInactive()"));
        gw.createInvoice(bytes32("inv-x"), address(usdc), 100e6, uint64(block.timestamp + 1 hours));
    }

    function test_CreateInvoice_UnsupportedPayIn_Reverts() public {
        address badToken = makeAddr("badPayIn");
        vm.prank(merchant);
        vm.expectRevert(abi.encodeWithSignature("InvalidPayInToken()"));
        gw.createInvoice(bytes32("inv-y"), badToken, 100e6, uint64(block.timestamp + 1 hours));
    }

    function test_CreateInvoice_DuplicateGlobalId_Reverts() public {
        bytes32 invoiceId = bytes32("inv-dup");
        vm.prank(merchant);
        bytes32 g = gw.createInvoice(invoiceId, address(usdc), 100e6, uint64(block.timestamp + 1 hours));
        vm.prank(merchant);
        vm.expectRevert(abi.encodeWithSignature("InvoiceAlreadyExists(bytes32)", g));
        gw.createInvoice(invoiceId, address(usdc), 100e6, uint64(block.timestamp + 1 hours));
    }

    // --- authorizeDelegate guard branch ---

    function test_AuthorizeDelegate_InactiveMerchant_Reverts() public {
        vm.prank(merchant);
        gw.deactivateMerchant();
        vm.prank(merchant);
        vm.expectRevert(abi.encodeWithSignature("NotMerchant()"));
        gw.authorizeDelegate(delegate, uint64(block.timestamp + 1 days), RIGHT_CI);
    }

    function test_AuthorizeDelegate_PastExpiry_Reverts() public {
        vm.prank(merchant);
        vm.expectRevert(abi.encodeWithSignature("InvalidDelegateExpiry()"));
        gw.authorizeDelegate(delegate, uint64(block.timestamp - 1), RIGHT_R);
    }

    function test_CreateInvoiceFor_ExpiredDelegate_OneSecondPast_Reverts() public {
        vm.prank(merchant);
        gw.authorizeDelegate(delegate, uint64(block.timestamp + 10), RIGHT_CI);

        vm.warp(block.timestamp + 11); // strictly past expiresAt

        vm.prank(delegate);
        vm.expectRevert(abi.encodeWithSignature("DelegateNotAuthorized()"));
        gw.createInvoiceFor(merchant, bytes32("inv-5"), address(usdc), 50e6, uint64(block.timestamp + 1 hours));
    }
}
