<?php
/**
 * Plugin Name: WordPress Bot REST Bridge
 * Description: Exposes theme_mod updates (custom logo) for the automation dashboard. Must-use plugin.
 * Version: 1.0.0
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
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
					set_theme_mod( 'custom_logo', $media_id );
					update_option( 'site_logo', $media_id );
					return rest_ensure_response(
						array(
							'custom_logo' => (int) get_theme_mod( 'custom_logo' ),
							'site_logo'   => (int) get_option( 'site_logo' ),
							'stylesheet'  => get_stylesheet(),
						)
					);
				},
				'args'                => array(
					'media_id' => array(
						'required'          => true,
						'type'              => 'integer',
						'sanitize_callback' => 'absint',
					),
				),
			)
		);
	}
);
