// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { GatewayTestBase } from "./GatewayTestBase.t.sol";
import { ArcFXGateway } from "../../src/ArcFXGateway.sol";

contract FeesTest is GatewayTestBase {
    /// @dev V13: fees accrue only at claim — settle excess stays in escrow.
    function _accrueFeeViaClaim(bytes32 invoiceId, uint256 amountOut, uint256 gross)
        internal
        returns (uint256 fee)
    {
        bytes32 g = _settle(invoiceId, amountOut, gross);
        vm.warp(block.timestamp + REFUND_WINDOW + 1);
        bytes32[] memory ids = new bytes32[](1);
        ids[0] = g;
        gw.claim(ids);
        fee = (gross * FEE_BPS) / 10_000;
    }

    // I1: withdrawFees rejects zero-address `to`
    function test_WithdrawFees_RejectsZeroTo() public {
        // First accrue some fees so we don't hit NoFeesToWithdraw first
        _accrueFeeViaClaim(bytes32("fee-1"), 100e6, 105e6);

        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSignature("InvalidPayoutAddress()"));
        gw.withdrawFees(address(eurc), address(0));
    }

    // I2: withdrawFees rejects zero balance
    function test_WithdrawFees_RejectsEmpty() public {
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSignature("NoFeesToWithdraw()"));
        gw.withdrawFees(address(eurc), admin);
    }

    // Happy path: transfers full balance and resets accrued to 0
    function test_WithdrawFees_HappyPath() public {
        // V13: settle accrues nothing; the single bps fee lands at claim.
        uint256 fee = _accrueFeeViaClaim(bytes32("fee-2"), 100e6, 105e6);

        uint256 before = eurc.balanceOf(admin);
        vm.prank(admin);
        gw.withdrawFees(address(eurc), admin);

        assertEq(eurc.balanceOf(admin), before + fee, "admin receives accrued fee");
        assertEq(gw.protocolFeesAccrued(address(eurc)), 0, "accrued resets to 0");
    }
}
