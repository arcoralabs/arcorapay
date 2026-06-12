// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Test } from "forge-std/Test.sol";
import { ArcFXGateway } from "../../src/ArcFXGateway.sol";

contract ConstructorTest is Test {
    address admin    = makeAddr("admin");
    address relayer  = makeAddr("relayer");

    function test_RejectFeeBpsAbove1000() public {
        vm.expectRevert(abi.encodeWithSignature("ProtocolFeeTooHigh(uint256)", 1001));
        new ArcFXGateway(1001, 7 days, 7 days, admin, relayer);
    }

    function test_AcceptFeeBpsAtBound() public {
        ArcFXGateway gw = new ArcFXGateway(1000, 7 days, 7 days, admin, relayer);
        assertEq(gw.PROTOCOL_FEE_BPS(), 1000);
    }

    function test_RejectZeroRefundWindow() public {
        vm.expectRevert(abi.encodeWithSignature("InvalidWindow()"));
        new ArcFXGateway(30, 0, 7 days, admin, relayer);
    }

    function test_RejectZeroRecoveryDelay() public {
        vm.expectRevert(abi.encodeWithSignature("InvalidWindow()"));
        new ArcFXGateway(30, 7 days, 0, admin, relayer);
    }

    function test_RejectZeroOwner() public {
        vm.expectRevert(abi.encodeWithSignature("InvalidPayoutAddress()"));
        new ArcFXGateway(30, 7 days, 7 days, address(0), relayer);
    }

    function test_RejectZeroRelayer() public {
        vm.expectRevert(abi.encodeWithSignature("InvalidPayoutAddress()"));
        new ArcFXGateway(30, 7 days, 7 days, admin, address(0));
    }
}
