// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { ERC20 }   from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

/// @title MintableERC20
/// @notice Owner-mintable ERC20 with configurable decimals. Testnet stablecoin mock.
contract MintableERC20 is ERC20, Ownable {
    uint8 private immutable _decimals;

    constructor(string memory name_, string memory symbol_, uint8 decimals_, address initialOwner)
        ERC20(name_, symbol_)
        Ownable(initialOwner)
    {
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
