<?php
/**
 * Arcora payment gateway — registers as a WooCommerce payment method, calls
 * the Arcora API on order placement, and redirects the customer to the hosted
 * checkout URL Arcora returns.
 */

if (!defined('ABSPATH')) {
    exit;
}

class WC_Arcora_Gateway extends WC_Payment_Gateway {

    public function __construct() {
        $this->id                 = 'arcora';
        $this->icon               = '';
        $this->has_fields         = false;
        $this->method_title       = __('Arcora — Stablecoin checkout', 'arcora-woocommerce');
        $this->method_description = __(
            'Accept USDC and EURC on Arc Network through Arcora\'s hosted checkout. Customer pays with their preferred stablecoin; merchant settles in the stable you choose.',
            'arcora-woocommerce'
        );
        $this->supports           = ['products', 'refunds'];

        $this->init_form_fields();
        $this->init_settings();

        $this->title         = $this->get_option('title');
        $this->description   = $this->get_option('description');
        $this->enabled       = $this->get_option('enabled');
        $this->environment   = $this->get_option('environment');
        $this->api_key       = $this->get_option('api_key');
        $this->settle_token  = $this->get_option('settle_token');
        $this->pay_in_token  = $this->get_option('pay_in_token');
        $this->base_url      = $this->resolve_base_url();

        add_action('woocommerce_update_options_payment_gateways_' . $this->id, [$this, 'process_admin_options']);
    }

    public function init_form_fields() {
        $this->form_fields = [
            'enabled' => [
                'title'   => __('Enable / Disable', 'arcora-woocommerce'),
                'type'    => 'checkbox',
                'label'   => __('Enable Arcora stablecoin checkout', 'arcora-woocommerce'),
                'default' => 'no',
            ],
            'title' => [
                'title'       => __('Title', 'arcora-woocommerce'),
                'type'        => 'text',
                'description' => __('Shown to the customer at checkout.', 'arcora-woocommerce'),
                'default'     => __('Pay with stablecoin (USDC / EURC)', 'arcora-woocommerce'),
                'desc_tip'    => true,
            ],
            'description' => [
                'title'   => __('Customer description', 'arcora-woocommerce'),
                'type'    => 'textarea',
                'default' => __('Settle in seconds on Arc Network. No card, no chargeback. You\'ll be redirected to Arcora\'s checkout to connect your wallet and approve the payment.', 'arcora-woocommerce'),
            ],
            'environment' => [
                'title'   => __('Environment', 'arcora-woocommerce'),
                'type'    => 'select',
                'default' => 'testnet',
                'options' => [
                    'testnet' => __('Testnet (Arc testnet)', 'arcora-woocommerce'),
                    'mainnet' => __('Mainnet', 'arcora-woocommerce'),
                ],
                'description' => __('Use Testnet for development; switch to Mainnet only after live merchant onboarding.', 'arcora-woocommerce'),
            ],
            'api_key' => [
                'title'       => __('API key', 'arcora-woocommerce'),
                'type'        => 'password',
                'description' => __('Get this from your Arcora merchant dashboard → Settings → API key.', 'arcora-woocommerce'),
                'desc_tip'    => true,
            ],
            'settle_token' => [
                'title'   => __('Settlement token', 'arcora-woocommerce'),
                'type'    => 'select',
                'default' => 'USDC',
                'options' => [
                    'USDC' => 'USDC',
                    'EURC' => 'EURC',
                ],
                'description' => __('The stablecoin Arcora sends to your payout address. The customer can pay in either USDC or EURC; Arcora swaps atomically.', 'arcora-woocommerce'),
            ],
            'pay_in_token' => [
                'title'   => __('Default pay-in token', 'arcora-woocommerce'),
                'type'    => 'select',
                'default' => 'USDC',
                'options' => [
                    'USDC' => 'USDC',
                    'EURC' => 'EURC',
                ],
                'description' => __('Suggested token for the customer at the hosted checkout. They can override this in the wallet step.', 'arcora-woocommerce'),
            ],
            'webhook_url' => [
                'title'       => __('Webhook URL (read-only)', 'arcora-woocommerce'),
                'type'        => 'text',
                'css'         => 'background:#f6f7f7;',
                'description' => __('Paste this into your Arcora dashboard → Webhooks. Order status updates flow through here.', 'arcora-woocommerce'),
                'default'     => home_url('/wc-api/wc_arcora_webhook'),
                'custom_attributes' => ['readonly' => 'readonly'],
            ],
            'webhook_secret' => [
                'title'       => __('Webhook secret', 'arcora-woocommerce'),
                'type'        => 'password',
                'description' => __('The HMAC-SHA256 secret Arcora generated when you registered the webhook URL above. Stored in wp_options; used to verify each incoming webhook.', 'arcora-woocommerce'),
                'desc_tip'    => true,
            ],
            // Audit Ops-M-5 (2026-05-31): receiver-side enforcement of the
            // replay-protected V2 signature. On (default) rejects any delivery
            // without a valid, in-window V2 signature so a captured legacy
            // webhook can't be replayed by stripping the V2 headers. Arcora
            // dual-signs every webhook since 2026-05-24; only turn this off if
            // you run a pre-dual-sign Arcora server during a rollout.
            'webhook_require_v2' => [
                'title'       => __('Require replay-protected webhooks', 'arcora-woocommerce'),
                'type'        => 'checkbox',
                'label'       => __('Reject webhooks without a valid timestamped (V2) signature', 'arcora-woocommerce'),
                'description' => __('Recommended. Closes a replay path where a captured legacy-signed webhook is re-sent with the V2 headers removed.', 'arcora-woocommerce'),
                'desc_tip'    => true,
                'default'     => 'yes',
            ],
        ];
    }

    /**
     * Map environment → Arcora API base URL.
     *
     * `arcorapay.xyz` is the canonical live host today. Arc Network itself
     * is testnet-only, so the "mainnet" branch points at the same testnet
     * base for now and will switch when Arc ships mainnet. The previous
     * `*.arcorapay.com` defaults pointed at unregistered DNS records and
     * silently broke every plugin install.
     */
    private function resolve_base_url(): string {
        return 'https://arcorapay.xyz';
    }

    public function process_payment($order_id) {
        $order = wc_get_order($order_id);
        if (!$order) {
            wc_add_notice(__('Order not found.', 'arcora-woocommerce'), 'error');
            return ['result' => 'failure'];
        }

        // Arcora invoices are USD-denominated; if the WooCommerce store is
        // configured in another currency the merchant has to convert before
        // we hit Arcora. v0.1 supports USD-only stores; everything else
        // surfaces an honest error rather than a silent miscalculation.
        $store_currency = strtoupper(get_woocommerce_currency());
        if ($store_currency !== 'USD') {
            $order->add_order_note(sprintf(
                /* translators: %s = store currency, e.g. EUR */
                __('Arcora only supports USD-denominated stores in v0.1; current currency is %s. Configure the store in USD or wait for v1.x multi-currency support.', 'arcora-woocommerce'),
                $store_currency
            ));
            wc_add_notice(__('This store\'s currency is not yet supported by Arcora. Please contact the merchant.', 'arcora-woocommerce'), 'error');
            return ['result' => 'failure'];
        }

        $body = [
            'amountUsdc'  => (float) $order->get_total(),
            'payInToken'  => $this->pay_in_token,
            'successUrl'  => $this->get_return_url($order),
            'cancelUrl'   => wc_get_checkout_url(),
            'metadata'    => [
                'order_id'   => (string) $order->get_id(),
                'merchant_order_key' => $order->get_order_key(),
                'store_url'  => home_url(),
            ],
        ];

        $response = wp_remote_post($this->base_url . '/api/invoices', [
            'timeout' => 20,
            'headers' => [
                'content-type'      => 'application/json',
                'X-Arcora-Api-Key'  => $this->api_key,
            ],
            'body'    => wp_json_encode($body),
        ]);

        if (is_wp_error($response)) {
            $msg = $response->get_error_message();
            $order->add_order_note('Arcora API error: ' . $msg);
            wc_add_notice(__('Payment provider unreachable. Please try again.', 'arcora-woocommerce'), 'error');
            return ['result' => 'failure'];
        }

        $code = wp_remote_retrieve_response_code($response);
        if ($code < 200 || $code >= 300) {
            $err = wp_remote_retrieve_body($response);
            $order->add_order_note(sprintf('Arcora returned HTTP %d: %s', $code, substr($err, 0, 500)));
            wc_add_notice(__('Couldn\'t initialise the payment. Please try again or contact the merchant.', 'arcora-woocommerce'), 'error');
            return ['result' => 'failure'];
        }

        $invoice = json_decode(wp_remote_retrieve_body($response), true);
        if (!is_array($invoice) || empty($invoice['invoiceId']) || empty($invoice['url'])) {
            $order->add_order_note('Arcora returned a malformed invoice payload.');
            wc_add_notice(__('Unexpected response from the payment provider.', 'arcora-woocommerce'), 'error');
            return ['result' => 'failure'];
        }

        $order->update_meta_data('_arcora_invoice_id', $invoice['invoiceId']);
        $order->update_meta_data('_arcora_environment', $this->environment);
        $order->save();

        // Mark on-hold while we wait for the on-chain settlement webhook.
        $order->update_status('on-hold', __('Awaiting Arcora on-chain settlement.', 'arcora-woocommerce'));
        // Empty the cart now so a back-button user sees it cleared.
        WC()->cart->empty_cart();

        return [
            'result'   => 'success',
            'redirect' => $invoice['url'],
        ];
    }
}
