<?php
/**
 * Announcement bar: a short message at the top of every page, with optional dates.
 *
 * @package ZenZeiTen\FormaToolkit
 */

namespace ZenZeiTen\FormaToolkit;

defined( 'ABSPATH' ) || exit;

/**
 * Announcement bar.
 */
class Announcement extends Module {

	/** {@inheritDoc} */
	public function id() {
		return 'announcement';
	}

	/** {@inheritDoc} */
	public function label() {
		return __( 'Announcement bar', 'zenzeiten-forma-toolkit' );
	}

	/** {@inheritDoc} */
	public function description() {
		return __( 'A slim message at the top of every page for offers, holiday hours or news. Visitors can close it, and it can start and stop on set dates.', 'zenzeiten-forma-toolkit' );
	}

	/** {@inheritDoc} */
	public function fields() {
		return array(
			'message'     => array( 'type' => 'rich', 'label' => __( 'Message', 'zenzeiten-forma-toolkit' ), 'help' => __( 'Keep it short. Bold, italic and links are allowed.', 'zenzeiten-forma-toolkit' ), 'default' => '', 'maxlength' => 300, 'rows' => 2 ),
			'link_url'    => array( 'type' => 'url', 'label' => __( 'Button link', 'zenzeiten-forma-toolkit' ), 'default' => '' ),
			'link_text'   => array( 'type' => 'text', 'label' => __( 'Button text', 'zenzeiten-forma-toolkit' ), 'default' => '', 'maxlength' => 40 ),
			'style'       => array(
				'type'    => 'select',
				'label'   => __( 'Colours', 'zenzeiten-forma-toolkit' ),
				'options' => array(
					'accent' => __( 'Accent colour', 'zenzeiten-forma-toolkit' ),
					'dark'   => __( 'Dark', 'zenzeiten-forma-toolkit' ),
					'soft'   => __( 'Soft', 'zenzeiten-forma-toolkit' ),
				),
				'default' => 'accent',
			),
			'dismissible' => array( 'type' => 'checkbox', 'label' => __( 'Let visitors close the bar', 'zenzeiten-forma-toolkit' ), 'help' => __( 'A closed bar stays closed for that visitor until you change the message.', 'zenzeiten-forma-toolkit' ), 'default' => true ),
			'start'       => array( 'type' => 'date', 'label' => __( 'Show from', 'zenzeiten-forma-toolkit' ), 'help' => __( 'Optional. Dates use the site\'s time zone.', 'zenzeiten-forma-toolkit' ), 'default' => '' ),
			'end'         => array( 'type' => 'date', 'label' => __( 'Show until (including this day)', 'zenzeiten-forma-toolkit' ), 'default' => '' ),
		);
	}

	/** {@inheritDoc} */
	public function boot() {
		add_action( 'wp_body_open', array( $this, 'render' ), 5 );
	}

	/**
	 * Whether the bar should show today.
	 *
	 * @param string|null $today Date as Y-m-d; defaults to today in the site's time zone.
	 * @return bool
	 */
	public function is_showing( $today = null ) {
		if ( '' === trim( wp_strip_all_tags( (string) $this->get( 'message' ) ) ) ) {
			return false;
		}
		$today = $today ? $today : wp_date( 'Y-m-d' );
		$start = (string) $this->get( 'start' );
		$end   = (string) $this->get( 'end' );
		return ( '' === $start || $today >= $start ) && ( '' === $end || $today <= $end );
	}

	/**
	 * Print the bar.
	 */
	public function render() {
		if ( is_admin() || ! $this->is_showing() ) {
			return;
		}
		$message = (string) $this->get( 'message' );
		$url     = (string) $this->get( 'link_url' );
		$text    = (string) $this->get( 'link_text' );
		$style   = (string) $this->get( 'style' );
		$key     = 'zzft-ann-' . substr( md5( $message . '|' . $url . '|' . $text ), 0, 10 );
		$colors  = array(
			'accent' => 'background:var(--wp--preset--color--accent,#22408f);color:var(--wp--preset--color--on-accent,#fff)',
			'dark'   => 'background:var(--wp--preset--color--contrast,#16150f);color:var(--wp--preset--color--base,#fbfaf7)',
			'soft'   => 'background:var(--wp--preset--color--surface,#f2efe9);color:var(--wp--preset--color--contrast,#16150f)',
		);
		$colors  = isset( $colors[ $style ] ) ? $colors[ $style ] : $colors['accent'];
		?>
		<div class="zzft-announcement" id="zzft-announcement" role="region" aria-label="<?php esc_attr_e( 'Announcement', 'zenzeiten-forma-toolkit' ); ?>" data-key="<?php echo esc_attr( $key ); ?>" style="<?php echo esc_attr( $colors ); ?>">
			<p class="zzft-announcement__text"><?php echo wp_kses( $message, array( 'a' => array( 'href' => true ), 'strong' => array(), 'em' => array() ) ); ?>
			<?php if ( $url && $text ) : ?>
				<a class="zzft-announcement__link" href="<?php echo esc_url( $url ); ?>"><?php echo esc_html( $text ); ?></a>
			<?php endif; ?>
			</p>
			<?php if ( $this->get( 'dismissible' ) ) : ?>
				<button type="button" class="zzft-announcement__close" aria-label="<?php esc_attr_e( 'Close announcement', 'zenzeiten-forma-toolkit' ); ?>">&times;</button>
			<?php endif; ?>
		</div>
		<style>
			.zzft-announcement{position:relative;display:flex;align-items:center;justify-content:center;gap:1rem;padding:.6rem 3rem;font-size:.9375rem;line-height:1.4;text-align:center}
			.zzft-announcement__text{margin:0}
			.zzft-announcement a{color:inherit;text-decoration:underline;text-underline-offset:.2em}
			.zzft-announcement__link{margin-left:.6rem;font-weight:600;white-space:nowrap}
			.zzft-announcement__close{position:absolute;right:.5rem;top:50%;transform:translateY(-50%);width:2rem;height:2rem;border:0;border-radius:50%;background:transparent;color:inherit;font-size:1.4rem;line-height:1;cursor:pointer}
			.zzft-announcement__close:hover{background:rgba(127,127,127,.2)}
			.zzft-announcement__close:focus-visible{outline:2px solid currentColor;outline-offset:2px}
		</style>
		<?php
		$script = '(function(){var b=document.getElementById("zzft-announcement");if(!b)return;var k=b.getAttribute("data-key");try{if(localStorage.getItem(k)){b.parentNode.removeChild(b);return}}catch(e){}var c=b.querySelector(".zzft-announcement__close");if(c){c.addEventListener("click",function(){try{localStorage.setItem(k,"1")}catch(e){}b.parentNode.removeChild(b)})}})();';
		wp_print_inline_script_tag( $script, array( 'id' => 'zzft-announcement-js' ) );
	}
}
