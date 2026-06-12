<?php
/**
 * Arcora webhook receiver. Listens at /wc-api/wc_arcora_webhook (the standard
 * WooCommerce REST surface for payment-gateway callbacks). Verifies the
 * X-Arcora-Signature HMAC against the per-merchant secret stored in the
 * Arcora dashboard, then transitions the matching WooCommerce order status.
 */

if (!defined('ABSPATH')) {
    exit;
}

class WC_Arcora_Webhook {

    public static function register(): void {
        add_action('woocommerce_api_wc_arcora_webhook', [self::class, 'handle']);
    }

    /**
     * Audit 2026-05-24 Ops-M2: replay window tolerance (seconds either side
     * of "now") that the V2 signature requires. Stripe ships ±5min by
     * default; we match.
     */
    const TIMESTAMP_TOLERANCE_SECONDS = 300;

    public static function handle(): void {
        $body = file_get_contents('php://input');
        $sigLegacy = isset($_SERVER['HTTP_X_ARCORA_SIGNATURE'])    ? sanitize_text_field((string) $_SERVER['HTTP_X_ARCORA_SIGNATURE'])    : '';
        $sigV2     = isset($_SERVER['HTTP_X_ARCORA_SIGNATURE_V2']) ? sanitize_text_field((string) $_SERVER['HTTP_X_ARCORA_SIGNATURE_V2']) : '';
        $tsHeader  = isset($_SERVER['HTTP_X_ARCORA_TIMESTAMP'])    ? sanitize_text_field((string) $_SERVER['HTTP_X_ARCORA_TIMESTAMP'])    : '';
        $gateway = new WC_Arcora_Gateway();
        $secret  = $gateway->get_option('webhook_secret');

        // Audit #21: respond() calls exit, but every guard below would
        // silently fall through if that contract ever changes (e.g. refactor
        // to throw, swap for wp_send_json which only echoes). Pair each
        // self::respond() with an explicit `return;` so the early-exit
        // semantics survive any future change to respond().
        //
        // Audit 2026-05-24 Ops-L3: empty() instead of `=== ''` so the
        // boolean `false` that WC_Payment_Gateway::get_option() returns when
        // the option row doesn't exist yet (first activation, broken DB,
        // migration) is treated as missing — not as an empty-string secret
        // that hash_hmac would silently coerce, leaving the receiver
        // accepting deterministic-forgeable signatures.
        if (empty($secret)) {
            self::respond(503, ['error' => 'webhook_secret_missing']);
            return;
        }
        $secret = (string) $secret;

        // Audit Ops-M-5 (2026-05-31): the scheme used to be chosen from the
        // REQUEST headers — V2 present → V2, else legacy. An attacker holding a
        // valid legacy-signed delivery could strip the V2 headers to force the
        // unbounded (no-timestamp) legacy path and replay it. The choice now
        // lives on the RECEIVER: when webhook_require_v2 is on (default), a
        // valid in-window V2 signature is mandatory with NO legacy fallback.
        // Arcora dual-signs every delivery since 2026-05-24, so this rejects
        // only stripped/forged or pre-dual-sign traffic.
        $requireV2 = $gateway->get_option('webhook_require_v2', 'yes') === 'yes';

        if ($requireV2) {
            if ($sigV2 === '' || $tsHeader === '') {
                self::respond(401, ['error' => 'v2_signature_required']);
                return;
            }
            if (!self::verify_timestamped_v2($body, $tsHeader, $sigV2, $secret)) {
                return; // verify_timestamped_v2 already emitted the 401
            }
        } else {
            // Legacy grace-period path (Ops-M2): prefer V2 when both headers
            // are present so a captured legacy webhook can't be replayed; fall
            // back to legacy for a pre-dual-sign Arcora server mid-rollout.
            if ($sigV2 !== '' && $tsHeader !== '') {
                if (!self::verify_timestamped_v2($body, $tsHeader, $sigV2, $secret)) {
                    return;
                }
            } else {
                if (!self::verify_signature($body, $sigLegacy, $secret)) {
                    self::respond(401, ['error' => 'invalid_signature']);
                    return;
                }
            }
        }

        $payload = json_decode($body, true);
        if (!is_array($payload) || empty($payload['type']) || empty($payload['invoice_id'])) {
            self::respond(400, ['error' => 'malformed_payload']);
            return;
        }

        $orders = wc_get_orders([
            'limit'      => 1,
            'meta_key'   => '_arcora_invoice_id',
            'meta_value' => $payload['invoice_id'],
            'meta_compare' => '=',
        ]);
        if (empty($orders)) {
            // Not necessarily an error — could be a webhook for an invoice
            // created from a different store. Reply 200 so Arcora doesn't
            // retry forever.
            self::respond(200, ['ok' => true, 'note' => 'order_not_found']);
            return;
        }
        $order = $orders[0];

        // Audit Ops-M-5 (2026-05-31): dedupe accepted events by
        // (type, invoice_id, tx_hash) so that even on the legacy grace path a
        // replayed delivery is a no-op, not a re-applied state transition (the
        // order-status guards below limit but don't fully close a refund→repay
        // replay). Processed keys are recorded on the order; the count per
        // order is naturally tiny (paid, maybe refunded).
        $txForKey  = isset($payload['tx_hash']) ? (string) $payload['tx_hash'] : '';
        $eventKey  = $payload['type'] . ':' . $payload['invoice_id'] . ':' . $txForKey;
        $processed = $order->get_meta('_arcora_processed_events', true);
        $processed = is_array($processed) ? $processed : [];
        if (in_array($eventKey, $processed, true)) {
            self::respond(200, ['ok' => true, 'note' => 'duplicate_event']);
            return;
        }

        switch ($payload['type']) {
            case 'invoice.paid':
                if ($order->get_status() !== 'completed') {
                    $tx = isset($payload['tx_hash']) ? sanitize_text_field((string) $payload['tx_hash']) : '';
                    $payer = isset($payload['paid_by']) ? sanitize_text_field((string) $payload['paid_by']) : '';
                    $note = sprintf(
                        /* translators: 1: payer wallet, 2: tx hash */
                        __('Arcora settled on-chain. Payer: %1$s · Tx: %2$s', 'arcora-woocommerce'),
                        $payer, $tx
                    );
                    $order->payment_complete($tx);
                    $order->add_order_note($note);
                }
                break;

            case 'invoice.refunded':
                if ($order->get_status() !== 'refunded') {
                    $tx = isset($payload['tx_hash']) ? sanitize_text_field((string) $payload['tx_hash']) : '';
                    $order->update_status('refunded', sprintf(
                        /* translators: %s = on-chain refund tx hash */
                        __('Arcora processed an on-chain refund · Tx: %s', 'arcora-woocommerce'),
                        $tx
                    ));
                }
                break;

            default:
                // Unknown but valid — log + ack so Arcora moves on.
                $order->add_order_note(sprintf('Arcora webhook (unhandled type=%s) ack\'d.', sanitize_text_field((string) $payload['type'])));
                break;
        }

        // Record the event key so a later replay of this exact delivery is a
        // no-op (Audit Ops-M-5, 2026-05-31).
        $processed[] = $eventKey;
        $order->update_meta_data('_arcora_processed_events', $processed);
        $order->save();

        self::respond(200, ['ok' => true]);
    }

    /**
     * Legacy X-Arcora-Signature: `sha256=<hex>` over the raw request body.
     */
    private static function verify_signature(string $body, string $sigHeader, string $secret): bool {
        if (strpos($sigHeader, 'sha256=') !== 0) {
            return false;
        }
        $given = substr($sigHeader, 7);
        $expected = hash_hmac('sha256', $body, $secret);
        return hash_equals($expected, $given);
    }

    /**
     * V2 verification including the replay window. Emits the appropriate 401
     * and returns false on any failure; returns true only when the signature
     * is valid AND within TIMESTAMP_TOLERANCE_SECONDS. Audit Ops-M-5
     * (2026-05-31): factored out so the require-V2 and legacy-grace paths share
     * one implementation.
     */
    private static function verify_timestamped_v2(string $body, string $timestamp, string $sigHeader, string $secret): bool {
        $ts = (int) $timestamp;
        if ($ts <= 0 || abs(time() - $ts) > self::TIMESTAMP_TOLERANCE_SECONDS) {
            self::respond(401, ['error' => 'timestamp_out_of_window']);
            return false;
        }
        if (!self::verify_signature_v2($body, $timestamp, $sigHeader, $secret)) {
            self::respond(401, ['error' => 'invalid_signature']);
            return false;
        }
        return true;
    }

    /**
     * V2 (audit 2026-05-24 Ops-M2): X-Arcora-Signature-V2 is
     * `sha256=<hex>` over `"<timestamp>.<body>"`. Binding the timestamp
     * into the signed payload means a captured webhook can't be replayed
     * once it falls outside TIMESTAMP_TOLERANCE_SECONDS — and a forged
     * timestamp invalidates the HMAC.
     */
    private static function verify_signature_v2(string $body, string $timestamp, string $sigHeader, string $secret): bool {
        if (strpos($sigHeader, 'sha256=') !== 0) {
            return false;
        }
        $given = substr($sigHeader, 7);
        $expected = hash_hmac('sha256', $timestamp . '.' . $body, $secret);
        return hash_equals($expected, $given);
    }

    /**
     * Tiny JSON responder so handle() reads top-down without nested noise.
     */
    private static function respond(int $code, array $body): void {
        status_header($code);
        header('Content-Type: application/json');
        echo wp_json_encode($body);
        exit;
    }
}
