// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { GatewayTestBase } from "./GatewayTestBase.t.sol";
import { ArcFXGateway } from "../../src/ArcFXGateway.sol";

contract MerchantTest is GatewayTestBase {
    function test_Register_AlreadyRegistered_Reverts() public {
        vm.prank(merchant);
        vm.expectRevert(abi.encodeWithSignature("MerchantAlreadyRegistered()"));
        gw.registerMerchant(payee, address(eurc));
    }

    function test_Deactivate_FlipsActive() public {
        vm.prank(merchant);
        gw.deactivateMerchant();
        (, , bool active) = gw.merchants(merchant);
        assertFalse(active);
    }

    function test_DeactivatedCannotReRegister() public {
        vm.prank(merchant);
        gw.deactivateMerchant();
        vm.prank(merchant);
        vm.expectRevert(abi.encodeWithSignature("MerchantAlreadyRegistered()"));
        gw.registerMerchant(payee, address(eurc));
    }

    function test_Reactivate_OnlyAdmin() public {
        vm.prank(merchant);
        gw.deactivateMerchant();
        vm.expectRevert();
        gw.reactivateMerchant(merchant);
        vm.prank(admin);
        gw.reactivateMerchant(merchant);
        (, , bool active) = gw.merchants(merchant);
        assertTrue(active);
    }

    function test_Reactivate_AlreadyActive_Reverts() public {
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSignature("MerchantAlreadyActive()"));
        gw.reactivateMerchant(merchant);
    }

    function test_Reactivate_NotMerchant_Reverts() public {
        address ghost = makeAddr("ghost");
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSignature("NotMerchant()"));
        gw.reactivateMerchant(ghost);
    }

    function test_UpdatePayoutAddress() public {
        address newPayee = makeAddr("newPayee");
        vm.prank(merchant);
        gw.updatePayoutAddress(newPayee);
        (address pa, , ) = gw.merchants(merchant);
        assertEq(pa, newPayee);
    }

    function test_UpdatePayoutToken() public {
        vm.prank(merchant);
        gw.updatePayoutToken(address(usdc));
        (, address pt, ) = gw.merchants(merchant);
        assertEq(pt, address(usdc));
    }

    // --- registerMerchant guard branches ---

    function test_Register_ZeroPayoutAddress_Reverts() public {
        address fresh = makeAddr("fresh");
        vm.prank(fresh);
        vm.expectRevert(abi.encodeWithSignature("InvalidPayoutAddress()"));
        gw.registerMerchant(address(0), address(eurc));
    }

    function test_Register_UnsupportedToken_Reverts() public {
        address fresh = makeAddr("fresh");
        address badToken = makeAddr("badToken");
        vm.prank(fresh);
        vm.expectRevert(abi.encodeWithSignature("InvalidPayoutToken()"));
        gw.registerMerchant(payee, badToken);
    }

    // --- updatePayoutAddress guard branches ---

    function test_UpdatePayoutAddress_InactiveMerchant_Reverts() public {
        vm.prank(merchant);
        gw.deactivateMerchant();
        vm.prank(merchant);
        vm.expectRevert(abi.encodeWithSignature("NotMerchant()"));
        gw.updatePayoutAddress(payee);
    }

    function test_UpdatePayoutAddress_ZeroAddress_Reverts() public {
        vm.prank(merchant);
        vm.expectRevert(abi.encodeWithSignature("InvalidPayoutAddress()"));
        gw.updatePayoutAddress(address(0));
    }

    // --- updatePayoutToken guard branches ---

    function test_UpdatePayoutToken_InactiveMerchant_Reverts() public {
        vm.prank(merchant);
        gw.deactivateMerchant();
        vm.prank(merchant);
        vm.expectRevert(abi.encodeWithSignature("NotMerchant()"));
        gw.updatePayoutToken(address(usdc));
    }

    function test_UpdatePayoutToken_UnsupportedToken_Reverts() public {
        address badToken = makeAddr("badToken");
        vm.prank(merchant);
        vm.expectRevert(abi.encodeWithSignature("InvalidPayoutToken()"));
        gw.updatePayoutToken(badToken);
    }

    // --- deactivateMerchant guard branch ---

    function test_Deactivate_AlreadyInactive_Reverts() public {
        vm.prank(merchant);
        gw.deactivateMerchant();
        vm.prank(merchant);
        vm.expectRevert(abi.encodeWithSignature("NotMerchant()"));
        gw.deactivateMerchant();
    }
}
