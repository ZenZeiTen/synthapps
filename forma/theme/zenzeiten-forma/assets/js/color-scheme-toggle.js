/**
 * Light/dark switch. Saves the visitor's choice; the inline script in <head> applies it on the
 * next page before it paints.
 */
( function () {
	'use strict';

	var KEY = 'zzforma-color-scheme';
	var root = document.documentElement;
	var media = window.matchMedia ? window.matchMedia( '(prefers-color-scheme: dark)' ) : null;
	var buttons = document.querySelectorAll( '.zzforma-scheme-toggle' );

	function current() {
		var value = root.getAttribute( 'data-color-scheme' );
		if ( value === 'dark' || value === 'light' ) {
			return value;
		}
		return media && media.matches ? 'dark' : 'light';
	}

	function sync() {
		var dark = current() === 'dark';
		for ( var i = 0; i < buttons.length; i++ ) {
			buttons[ i ].setAttribute( 'aria-pressed', dark ? 'true' : 'false' );
		}
	}

	function toggle() {
		var next = current() === 'dark' ? 'light' : 'dark';
		root.setAttribute( 'data-color-scheme', next );
		try {
			window.localStorage.setItem( KEY, next );
		} catch ( e ) {
			// Storage can be blocked; the choice then lasts for this page only.
		}
		sync();
	}

	for ( var i = 0; i < buttons.length; i++ ) {
		buttons[ i ].addEventListener( 'click', toggle );
	}
	if ( media ) {
		if ( media.addEventListener ) {
			media.addEventListener( 'change', sync );
		} else if ( media.addListener ) {
			media.addListener( sync );
		}
	}
	sync();
} )();
