<?php
/**
 * Plugin Name: WordPress Bot REST Bridge
 * Description: Exposes theme_mod updates (custom logo and Braine Redux logos) for the automation dashboard. Must-use plugin.
 * Version: 1.1.0
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Braine stores header/footer logos in the Redux theme_mod `braine_options-mods`
 * (`light_color_logo`, `dark_color_logo`, footer logo fields). It does not render
 * core `custom_logo` in the header; an empty URL falls back to assets/images/logo.svg.
 *
 * @param int    $media_id   Attachment ID.
 * @param string $source_url Absolute image URL.
 * @return string Saved light-logo URL, or empty when this is not the Braine theme.
 */
function wordpress_bot_apply_braine_logo( $media_id, $source_url ) {
	$theme      = wp_get_theme();
	$stylesheet = strtolower( (string) $theme->get_stylesheet() );
	$template   = strtolower( (string) $theme->get_template() );
	$name       = strtolower( (string) $theme->get( 'Name' ) );
	$is_braine  = ( 'braine' === $stylesheet || 'braine' === $template || false !== strpos( $name, 'braine' ) );
	if ( ! $is_braine || '' === $source_url ) {
		return '';
	}

	$media = array(
		'url'       => $source_url,
		'id'        => (string) $media_id,
		'height'    => '',
		'width'     => '',
		'thumbnail' => $source_url,
	);
	$keys  = array(
		'light_color_logo',
		'dark_color_logo',
		'footer_logo_image',
		'footer_logo_image_v2',
		'footer4_logo_image',
	);

	$mods = get_theme_mod( 'braine_options-mods' );
	if ( ! is_array( $mods ) ) {
		$mods = array();
	}
	$mods['normal_logo_show'] = '1';
	$mods['dark_logo_show']   = '1';
	foreach ( $keys as $key ) {
		$mods[ $key ] = $media;
	}
	set_theme_mod( 'braine_options-mods', $mods );

	$stored = get_option( 'braine_options', array() );
	if ( is_array( $stored ) && ! empty( $stored ) ) {
		$stored['normal_logo_show'] = '1';
		$stored['dark_logo_show']   = '1';
		foreach ( $keys as $key ) {
			$stored[ $key ] = $media;
		}
		update_option( 'braine_options', $stored );
	}

	$check = get_theme_mod( 'braine_options-mods' );
	if ( is_array( $check ) && ! empty( $check['light_color_logo']['url'] ) ) {
		return (string) $check['light_color_logo']['url'];
	}
	return '';
}

add_action(
	'rest_api_init',
	static function () {
		register_rest_route(
			'wordpress-bot/v1',
			'/theme-mod/custom_logo',
			array(
				'methods'             => 'POST',
				'permission_callback' => static function () {
					return current_user_can( 'edit_theme_options' );
				},
				'callback'            => static function ( WP_REST_Request $request ) {
					$media_id = (int) $request->get_param( 'media_id' );
					if ( $media_id <= 0 ) {
						return new WP_Error(
							'wordpress_bot_invalid_media',
							'media_id must be a positive attachment ID.',
							array( 'status' => 400 )
						);
					}
					if ( ! wp_attachment_is_image( $media_id ) ) {
						return new WP_Error(
							'wordpress_bot_invalid_attachment',
							'Attachment is not an image.',
							array( 'status' => 400 )
						);
					}
					$source_url = esc_url_raw( (string) $request->get_param( 'source_url' ) );
					if ( '' === $source_url ) {
						$source_url = (string) wp_get_attachment_url( $media_id );
					}
					set_theme_mod( 'custom_logo', $media_id );
					update_option( 'site_logo', $media_id );
					$braine_logo = wordpress_bot_apply_braine_logo( $media_id, $source_url );
					$theme       = wp_get_theme();
					return rest_ensure_response(
						array(
							'custom_logo'    => (int) get_theme_mod( 'custom_logo' ),
							'site_logo'      => (int) get_option( 'site_logo' ),
							'stylesheet'     => get_stylesheet(),
							'template'       => $theme->get_template(),
							'bridge_version' => 2,
							'braine_logo'    => $braine_logo,
						)
					);
				},
				'args'                => array(
					'media_id'   => array(
						'required'          => true,
						'type'              => 'integer',
						'sanitize_callback' => 'absint',
					),
					'source_url' => array(
						'required' => false,
						'type'     => 'string',
					),
				),
			)
		);
	}
);
