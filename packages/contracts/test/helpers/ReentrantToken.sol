// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice ERC20 that calls back into a target on every transfer. Used to
/// verify the gateway's nonReentrant guards survive token reentry.
contract ReentrantToken is ERC20 {
    address public target;
    bytes   public reentryCalldata;
    bool    public attackArmed;

    constructor() ERC20("Re", "RE") {}

    function arm(address t, bytes calldata data) external {
        target = t;
        reentryCalldata = data;
        attackArmed = true;
    }

    function mint(address to, uint256 amount) external { _mint(to, amount); }

    function decimals() public pure override returns (uint8) { return 6; }

    function _update(address from, address to, uint256 amount) internal override {
        super._update(from, to, amount);
        if (attackArmed) {
            attackArmed = false; // single-shot
            (bool ok, ) = target.call(reentryCalldata);
            ok; // we don't assert here — the gateway's revert on reentry is what matters
        }
    }
}
