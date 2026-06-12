// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Test } from "forge-std/Test.sol";
import { ArcFXGateway } from "../../src/ArcFXGateway.sol";
import { ReentrantToken } from "../helpers/ReentrantToken.sol";

contract ReentrancyTest is Test {
    ArcFXGateway gw;
    ReentrantToken token;

    address admin    = makeAddr("admin");
    address relayer  = makeAddr("relayer");
    address merchant = makeAddr("merchant");
    address payee    = makeAddr("payee");
    address customer = makeAddr("customer");

    function setUp() public {
        vm.warp(1_700_000_000);
        token = new ReentrantToken();
        gw = new ArcFXGateway(30, 7 days, 7 days, admin, relayer);
        vm.prank(admin); gw.setTokenSupport(address(token), true);
        vm.prank(merchant); gw.registerMerchant(payee, address(token));
    }

    function test_Refund_ReentryReverts() public {
        // Settle a paid invoice
        vm.prank(merchant);
        bytes32 g = gw.createInvoice(bytes32("re-1"), address(token), 100e6, uint64(block.timestamp + 1 hours));
        token.mint(relayer, 100e6);
        vm.prank(relayer); token.approve(address(gw), 100e6);
        vm.prank(relayer);
        gw.settleInvoice(g, customer, address(token), 100e6, 100e6, bytes32(0));

        // Arm token to re-enter refundInvoice during the safeTransfer leg
        token.arm(address(gw), abi.encodeWithSignature("refundInvoice(bytes32)", g));

        vm.prank(merchant);
        // The outer call succeeds (token transfer completes), but the nested
        // call reverts internally; since ReentrantToken swallows the revert,
        // we assert the outer state is consistent (single drain, status flipped once).
        gw.refundInvoice(g);

        (, , , , , ArcFXGateway.InvoiceStatus s, ) = gw.invoices(g);
        assertEq(uint8(s), uint8(ArcFXGateway.InvoiceStatus.Refunded), "single refund");
        assertEq(token.balanceOf(customer), 100e6, "no double drain");
    }
}
