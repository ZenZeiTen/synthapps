<?php
/**
 * Business details module: enter your contact details once and reuse them everywhere.
 *
 * @package Corbelwise\Toolkit
 */

namespace Corbelwise\Toolkit;

defined( 'ABSPATH' ) || exit;

/**
 * Business details, shortcodes and the data behind the business's structured data.
 */
class Business extends Module {

	/**
	 * Social profiles: field key => label.
	 *
	 * @return array<string, string>
	 */
	public static function networks() {
		return array(
			'facebook'  => 'Facebook',
			'instagram' => 'Instagram',
			'linkedin'  => 'LinkedIn',
			'x'         => 'X',
			'youtube'   => 'YouTube',
			'tiktok'    => 'TikTok',
		);
	}

	/** {@inheritDoc} */
	public function id() {
		return 'business';
	}

	/** {@inheritDoc} */
	public function label() {
		return __( 'Business details', 'corbelwise-toolkit' );
	}

	/** {@inheritDoc} */
	public function description() {
		return __( 'Your name, address, phone, email, opening hours and social profiles, entered once. Show them anywhere with a shortcode; search engines get them as structured data when the SEO module is on; the AI assistant uses them to answer questions.', 'corbelwise-toolkit' );
	}

	/** {@inheritDoc} */
	public function default_enabled() {
		return true;
	}

	/** {@inheritDoc} */
	public function fields() {
		$fields = array(
			'name'        => array( 'type' => 'text', 'label' => __( 'Business name', 'corbelwise-toolkit' ), 'help' => __( 'Leave empty to use the site title.', 'corbelwise-toolkit' ), 'default' => '', 'maxlength' => 120 ),
			'type'        => array(
				'type'    => 'select',
				'label'   => __( 'Kind of business', 'corbelwise-toolkit' ),
				'help'    => __( 'Used for search engines. Choose "Online business" if customers never visit you in person.', 'corbelwise-toolkit' ),
				'options' => array(
					'LocalBusiness'               => __( 'Local business (general)', 'corbelwise-toolkit' ),
					'ProfessionalService'         => __( 'Professional service', 'corbelwise-toolkit' ),
					'LegalService'                => __( 'Legal service', 'corbelwise-toolkit' ),
					'AccountingService'           => __( 'Accounting', 'corbelwise-toolkit' ),
					'FinancialService'            => __( 'Financial service', 'corbelwise-toolkit' ),
					'MedicalBusiness'             => __( 'Medical or health practice', 'corbelwise-toolkit' ),
					'HealthAndBeautyBusiness'     => __( 'Health and beauty', 'corbelwise-toolkit' ),
					'Restaurant'                  => __( 'Restaurant or café', 'corbelwise-toolkit' ),
					'Store'                       => __( 'Shop', 'corbelwise-toolkit' ),
					'HomeAndConstructionBusiness' => __( 'Home services and construction', 'corbelwise-toolkit' ),
					'AutomotiveBusiness'          => __( 'Automotive', 'corbelwise-toolkit' ),
					'EducationalOrganization'     => __( 'Education and training', 'corbelwise-toolkit' ),
					'TravelAgency'                => __( 'Travel', 'corbelwise-toolkit' ),
					'Organization'                => __( 'Online business (no visiting address)', 'corbelwise-toolkit' ),
				),
				'default' => 'LocalBusiness',
			),
			'summary'     => array( 'type' => 'textarea', 'label' => __( 'What you do', 'corbelwise-toolkit' ), 'help' => __( 'One or two sentences. Used in structured data and by the AI assistant.', 'corbelwise-toolkit' ), 'default' => '', 'maxlength' => 500, 'rows' => 3 ),
			'phone'       => array( 'type' => 'text', 'label' => __( 'Phone', 'corbelwise-toolkit' ), 'help' => __( 'In international format, for example +62 21 555 0100.', 'corbelwise-toolkit' ), 'default' => '', 'maxlength' => 40 ),
			'email'       => array( 'type' => 'email', 'label' => __( 'Email', 'corbelwise-toolkit' ), 'default' => '' ),
			'street'      => array( 'type' => 'text', 'label' => __( 'Street address', 'corbelwise-toolkit' ), 'default' => '', 'maxlength' => 200 ),
			'city'        => array( 'type' => 'text', 'label' => __( 'City', 'corbelwise-toolkit' ), 'default' => '', 'maxlength' => 100 ),
			'region'      => array( 'type' => 'text', 'label' => __( 'State or province', 'corbelwise-toolkit' ), 'default' => '', 'maxlength' => 100 ),
			'postcode'    => array( 'type' => 'text', 'label' => __( 'Postcode', 'corbelwise-toolkit' ), 'default' => '', 'maxlength' => 20 ),
			'country'     => array( 'type' => 'text', 'label' => __( 'Country', 'corbelwise-toolkit' ), 'help' => __( 'Two-letter code such as ID, US or DE.', 'corbelwise-toolkit' ), 'default' => '', 'maxlength' => 2 ),
			'map_url'     => array( 'type' => 'url', 'label' => __( 'Map link', 'corbelwise-toolkit' ), 'help' => __( 'A link to your location on a map service.', 'corbelwise-toolkit' ), 'default' => '' ),
			'hours'       => array( 'type' => 'textarea', 'label' => __( 'Opening hours', 'corbelwise-toolkit' ), 'help' => __( 'One line per entry, for example "Monday to Friday: 9:00 to 17:00".', 'corbelwise-toolkit' ), 'default' => '', 'maxlength' => 600, 'rows' => 4 ),
			'price_range' => array( 'type' => 'text', 'label' => __( 'Price range', 'corbelwise-toolkit' ), 'help' => __( 'Optional, for example "$$" or "Rp 100.000 to Rp 500.000".', 'corbelwise-toolkit' ), 'default' => '', 'maxlength' => 60 ),
			'social'      => array( 'type' => 'heading', 'label' => __( 'Social profiles', 'corbelwise-toolkit' ), 'help' => __( 'Full addresses of your profiles. Empty ones are skipped.', 'corbelwise-toolkit' ) ),
		);
		foreach ( self::networks() as $key => $label ) {
			$fields[ 'social_' . $key ] = array( 'type' => 'url', 'label' => $label, 'default' => '' );
		}
		return $fields;
	}

	/** {@inheritDoc} */
	public function boot() {
		add_shortcode( 'corbelwise_business', array( $this, 'shortcode' ) );
		add_shortcode( 'corbelwise_social_links', array( $this, 'social_shortcode' ) );
	}

	/**
	 * The business name.
	 *
	 * @return string
	 */
	public function name() {
		$name = trim( (string) $this->get( 'name' ) );
		return '' !== $name ? $name : get_bloginfo( 'name' );
	}

	/**
	 * Opening hours as lines.
	 *
	 * @return string[]
	 */
	public function hours() {
		return array_values( array_filter( array_map( 'trim', explode( "\n", (string) $this->get( 'hours' ) ) ) ) );
	}

	/**
	 * Address lines that are filled in.
	 *
	 * @return string[]
	 */
	public function address_lines() {
		$city = trim( implode( ' ', array_filter( array( $this->get( 'postcode' ), $this->get( 'city' ) ) ) ) );
		return array_values( array_filter( array( $this->get( 'street' ), $city, $this->get( 'region' ), strtoupper( (string) $this->get( 'country' ) ) ) ) );
	}

	/**
	 * Social profile URLs that are filled in.
	 *
	 * @return array<string, string> Network key => URL.
	 */
	public function social() {
		$out = array();
		foreach ( array_keys( self::networks() ) as $key ) {
			$url = (string) $this->get( 'social_' . $key );
			if ( '' !== $url ) {
				$out[ $key ] = $url;
			}
		}
		return $out;
	}

	/**
	 * Plain-text facts for the AI assistant.
	 *
	 * @return string
	 */
	public function facts() {
		$lines = array( 'Business name: ' . $this->name() );
		$map   = array(
			'summary'     => 'About',
			'phone'       => 'Phone',
			'email'       => 'Email',
			'price_range' => 'Price range',
			'map_url'     => 'Map',
		);
		foreach ( $map as $key => $label ) {
			$value = trim( (string) $this->get( $key ) );
			if ( '' !== $value ) {
				$lines[] = $label . ': ' . $value;
			}
		}
		if ( $this->address_lines() ) {
			$lines[] = 'Address: ' . implode( ', ', $this->address_lines() );
		}
		if ( $this->hours() ) {
			$lines[] = 'Opening hours: ' . implode( '; ', $this->hours() );
		}
		return implode( "\n", $lines );
	}

	/**
	 * Structured data (schema.org) for the business.
	 *
	 * @return array
	 */
	public function schema() {
		$type = (string) $this->get( 'type' );
		$data = array(
			'@type' => $type ? $type : 'LocalBusiness',
			'@id'   => home_url( '/#organization' ),
			'name'  => $this->name(),
			'url'   => home_url( '/' ),
		);
		$summary = trim( (string) $this->get( 'summary' ) );
		if ( '' !== $summary ) {
			$data['description'] = $summary;
		}
		if ( $this->get( 'phone' ) ) {
			$data['telephone'] = (string) $this->get( 'phone' );
		}
		if ( $this->get( 'email' ) ) {
			$data['email'] = (string) $this->get( 'email' );
		}
		if ( 'Organization' !== $data['@type'] && $this->get( 'street' ) ) {
			$data['address'] = array_filter(
				array(
					'@type'           => 'PostalAddress',
					'streetAddress'   => (string) $this->get( 'street' ),
					'addressLocality' => (string) $this->get( 'city' ),
					'addressRegion'   => (string) $this->get( 'region' ),
					'postalCode'      => (string) $this->get( 'postcode' ),
					'addressCountry'  => strtoupper( (string) $this->get( 'country' ) ),
				)
			);
		}
		if ( 'Organization' !== $data['@type'] && $this->get( 'price_range' ) ) {
			$data['priceRange'] = (string) $this->get( 'price_range' );
		}
		if ( $this->get( 'map_url' ) ) {
			$data['hasMap'] = (string) $this->get( 'map_url' );
		}
		if ( $this->social() ) {
			$data['sameAs'] = array_values( $this->social() );
		}
		return $data;
	}

	/**
	 * [corbelwise_business field="phone"]: one detail, linked where that makes sense.
	 *
	 * Fields: name, phone, email, address, hours, map, summary.
	 *
	 * @param array|string $atts Attributes.
	 * @return string
	 */
	public function shortcode( $atts ) {
		$atts  = shortcode_atts(
			array(
				'field' => 'name',
				'link'  => 'yes',
			),
			$atts,
			'corbelwise_business'
		);
		$field = sanitize_key( $atts['field'] );
		$link  = 'no' !== $atts['link'];

		switch ( $field ) {
			case 'phone':
				$phone = (string) $this->get( 'phone' );
				if ( '' === $phone ) {
					return '';
				}
				$tel = preg_replace( '/[^0-9+]/', '', $phone );
				return $link ? '<a class="cwtk-phone" href="' . esc_url( 'tel:' . $tel ) . '">' . esc_html( $phone ) . '</a>' : esc_html( $phone );
			case 'email':
				$email = (string) $this->get( 'email' );
				if ( '' === $email ) {
					return '';
				}
				$shown = antispambot( $email );
				return $link ? '<a class="cwtk-email" href="' . esc_url( 'mailto:' . antispambot( $email, 1 ) ) . '">' . $shown . '</a>' : $shown; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- antispambot() returns only HTML entities.
			case 'address':
				$lines = $this->address_lines();
				return $lines ? '<address class="cwtk-address">' . implode( '<br>', array_map( 'esc_html', $lines ) ) . '</address>' : '';
			case 'hours':
				$hours = $this->hours();
				return $hours ? '<ul class="cwtk-hours">' . implode( '', array_map( static function ( $line ) { return '<li>' . esc_html( $line ) . '</li>'; }, $hours ) ) . '</ul>' : '';
			case 'map':
				$url = (string) $this->get( 'map_url' );
				return $url ? '<a class="cwtk-map" href="' . esc_url( $url ) . '" rel="noopener">' . esc_html__( 'View on map', 'corbelwise-toolkit' ) . '</a>' : '';
			case 'summary':
				return esc_html( (string) $this->get( 'summary' ) );
			case 'name':
			default:
				return esc_html( $this->name() );
		}
	}

	/**
	 * [corbelwise_social_links]: a list of links to the social profiles that are filled in.
	 *
	 * @return string
	 */
	public function social_shortcode() {
		$links = $this->social();
		if ( ! $links ) {
			return '';
		}
		$names = self::networks();
		$items = '';
		foreach ( $links as $key => $url ) {
			$items .= '<li><a href="' . esc_url( $url ) . '" rel="me noopener">' . esc_html( $names[ $key ] ) . '</a></li>';
		}
		return '<ul class="cwtk-social" style="display:flex;flex-wrap:wrap;gap:0.5rem 1.25rem;list-style:none;margin:0;padding:0">' . $items . '</ul>';
	}
}
