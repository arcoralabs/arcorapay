// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { GatewayTestBase } from "./GatewayTestBase.t.sol";

contract PauseTest is GatewayTestBase {
    function test_Paused_BlocksCreateInvoice() public {
        vm.prank(admin); gw.pause();
        vm.prank(merchant);
        vm.expectRevert(); // EnforcedPause
        gw.createInvoice(bytes32("p-1"), address(usdc), 100e6, uint64(block.timestamp + 1 hours));
    }

    function test_Paused_BlocksSettle() public {
        bytes32 g = _createInvoice(bytes32("p-2"), 100e6, 1 hours);
        vm.prank(admin); gw.pause();
        _fundRelayer(eurc, 100e6);
        vm.prank(relayer);
        vm.expectRevert();
        gw.settleInvoice(g, customer, address(usdc), 100e6, 100e6, bytes32(0));
    }

    function test_Paused_AllowsClaim() public {
        bytes32 g = _settle(bytes32("p-3"), 100e6, 100e6);
        vm.warp(block.timestamp + REFUND_WINDOW + 1);
        vm.prank(admin); gw.pause();
        bytes32[] memory ids = new bytes32[](1); ids[0] = g;
        gw.claim(ids);
    }

    function test_Paused_AllowsWithdrawFees() public {
        bytes32 g = _settle(bytes32("p-4"), 100e6, 100e6);
        vm.warp(block.timestamp + REFUND_WINDOW + 1);
        bytes32[] memory ids = new bytes32[](1); ids[0] = g;
        gw.claim(ids);
        vm.prank(admin); gw.pause();
        vm.prank(admin);
        gw.withdrawFees(address(eurc), admin);
    }
}
