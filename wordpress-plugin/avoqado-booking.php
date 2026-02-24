<?php
/**
 * Plugin Name: Avoqado Booking Widget
 * Plugin URI: https://avoqado.io
 * Description: Embeds the Avoqado online booking widget on any WordPress page or post.
 * Version: 1.0.0
 * Author: Avoqado
 * License: MIT
 */

if (!defined('ABSPATH')) exit;

function avoqado_booking_shortcode($atts) {
    $atts = shortcode_atts([
        'venue'        => '',
        'locale'       => 'es',
        'theme'        => 'auto',
        'mode'         => 'inline',
        'accent-color' => '',
        'button-text'  => '',
    ], $atts, 'avoqado_booking');

    if (empty($atts['venue'])) {
        return '<p style="color:red;">Avoqado Booking: el atributo <code>venue</code> es requerido.</p>';
    }

    $attrs = sprintf(
        'venue="%s" locale="%s" theme="%s" mode="%s"',
        esc_attr($atts['venue']),
        esc_attr($atts['locale']),
        esc_attr($atts['theme']),
        esc_attr($atts['mode'])
    );

    if (!empty($atts['accent-color'])) {
        $attrs .= sprintf(' accent-color="%s"', esc_attr($atts['accent-color']));
    }
    if (!empty($atts['button-text'])) {
        $attrs .= sprintf(' button-text="%s"', esc_attr($atts['button-text']));
    }

    $script_url = 'https://cdn.avoqado.io/widget.js';

    return sprintf(
        '<script src="%s" defer></script><avoqado-booking %s></avoqado-booking>',
        esc_url($script_url),
        $attrs
    );
}
add_shortcode('avoqado_booking', 'avoqado_booking_shortcode');

/**
 * Add the script only once even if shortcode used multiple times
 */
function avoqado_booking_enqueue() {
    if (is_singular() && has_shortcode(get_post()->post_content, 'avoqado_booking')) {
        wp_enqueue_script(
            'avoqado-booking-widget',
            'https://cdn.avoqado.io/widget.js',
            [],
            null,
            true
        );
    }
}
add_action('wp_enqueue_scripts', 'avoqado_booking_enqueue');
