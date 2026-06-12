<?php
/**
 * Plugin Name:       Arcora — Stablecoin Checkout
 * Plugin URI:        https://github.com/arcoralabs/arcorapay
 * Description:       Accept stablecoin payments (USDC, EURC) on Arc Network through Arcora's hosted checkout. Customer pays with their preferred stablecoin; merchant settles in the stable they choose. Atomic on-chain settlement, sub-second finality, refunds in payout token.
 * Version:           1.0.0
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * Author:            Arcora
 * Author URI:        https://github.com/arcoralabs/arcorapay
 * License:           MIT
 * Text Domain:       arcora-woocommerce
 * WC requires at least: 7.0
 * WC tested up to:   9.0
 *
 * @package           Arcora\WooCommerce
 */

if (!defined('ABSPATH')) {
    exit;
}

define('ARCORA_WC_VERSION', '1.0.0');
define('ARCORA_WC_PLUGIN_FILE', __FILE__);
define('ARCORA_WC_PLUGIN_DIR', plugin_dir_path(__FILE__));

/**
 * Bootstrap once WooCommerce has loaded — without WC the gateway base class
 * isn't defined, so registering early throws a fatal.
 */
add_action('plugins_loaded', static function () {
    if (!class_exists('WC_Payment_Gateway')) {
        add_action('admin_notices', static function () {
            $msg = __(
                'Arcora — Stablecoin Checkout requires WooCommerce to be installed and active.',
                'arcora-woocommerce'
            );
            echo '<div class="notice notice-error"><p>' . esc_html($msg) . '</p></div>';
        });
        return;
    }

    require_once ARCORA_WC_PLUGIN_DIR . 'includes/class-wc-arcora-gateway.php';
    require_once ARCORA_WC_PLUGIN_DIR . 'includes/class-wc-arcora-webhook.php';

    add_filter('woocommerce_payment_gateways', static function ($methods) {
        $methods[] = 'WC_Arcora_Gateway';
        return $methods;
    });

    // Webhook listener — Arcora POSTs invoice.paid / invoice.refunded events here.
    WC_Arcora_Webhook::register();
});

/**
 * Settings link on the Plugins admin page (cosmetic; saves merchants a click).
 */
add_filter('plugin_action_links_' . plugin_basename(__FILE__), static function ($links) {
    $url = admin_url('admin.php?page=wc-settings&tab=checkout&section=arcora');
    array_unshift($links, '<a href="' . esc_url($url) . '">' . esc_html__('Settings', 'arcora-woocommerce') . '</a>');
    return $links;
});
