/**
 * Visitor Sentinel admin: dashboard chart, live visitors and confirm prompts.
 */
( function () {
	'use strict';

	var cfg = window.vsenAdmin || { i18n: {} };
	var t = cfg.i18n || {};
	var NS = 'http://www.w3.org/2000/svg';

	function el( name, attrs, parent ) {
		var node = document.createElementNS( NS, name );
		Object.keys( attrs || {} ).forEach( function ( key ) {
			node.setAttribute( key, attrs[ key ] );
		} );
		if ( parent ) {
			parent.appendChild( node );
		}
		return node;
	}

	function niceMax( value ) {
		if ( value <= 4 ) {
			return 4;
		}
		var power = Math.pow( 10, Math.floor( Math.log10( value ) ) );
		var steps = [ 1, 2, 2.5, 5, 10 ];
		for ( var i = 0; i < steps.length; i++ ) {
			if ( steps[ i ] * power >= value ) {
				return steps[ i ] * power;
			}
		}
		return 10 * power;
	}

	function fmt( n ) {
		return Number( n ).toLocaleString();
	}

	// -------------------------------------------------------------------------------------------
	// Chart: pageviews and visitors as lines (left axis), ad clicks and fraud as bars (right axis).
	// -------------------------------------------------------------------------------------------

	function drawChart( host ) {
		var series;
		try {
			series = JSON.parse( host.getAttribute( 'data-series' ) || '[]' );
		} catch ( e ) {
			series = [];
		}
		if ( ! series.length ) {
			return;
		}

		var W = 760;
		var H = 260;
		var pad = { l: 44, r: 40, t: 12, b: 28 };
		var iw = W - pad.l - pad.r;
		var ih = H - pad.t - pad.b;
		var n = series.length;
		var step = iw / n;

		var trafficMax = niceMax( Math.max.apply( null, series.map( function ( d ) {
			return Math.max( d.pageviews, d.visitors );
		} ) ) );
		var adsMax = niceMax( Math.max.apply( null, series.map( function ( d ) {
			return d.ads;
		} ) ) );

		var svg = el( 'svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'vsen-chart__svg' } );
		var x = function ( i ) {
			return pad.l + step * i + step / 2;
		};
		var yT = function ( v ) {
			return pad.t + ih - ( ih * v ) / trafficMax;
		};
		var yA = function ( v ) {
			return pad.t + ih - ( ih * v ) / adsMax;
		};

		// Grid and axis labels.
		for ( var g = 0; g <= 4; g++ ) {
			var gy = pad.t + ( ih * g ) / 4;
			el( 'line', { x1: pad.l, x2: W - pad.r, y1: gy, y2: gy, class: 'vsen-chart__grid' }, svg );
			el( 'text', { x: pad.l - 8, y: gy + 4, class: 'vsen-chart__axis', 'text-anchor': 'end' }, svg ).textContent = fmt( Math.round( trafficMax * ( 1 - g / 4 ) ) );
			el( 'text', { x: W - pad.r + 8, y: gy + 4, class: 'vsen-chart__axis vsen-chart__axis--ads' }, svg ).textContent = fmt( Math.round( adsMax * ( 1 - g / 4 ) ) );
		}
		var every = Math.ceil( n / 8 );
		series.forEach( function ( d, i ) {
			// Label every few days, and the last day unless it would crowd the previous label.
			if ( 0 === i % every || ( i === n - 1 && i % every >= every / 2 ) ) {
				el( 'text', { x: x( i ), y: H - 8, class: 'vsen-chart__axis', 'text-anchor': 'middle' }, svg ).textContent = d.label;
			}
		} );

		// Bars.
		var bw = Math.max( 2, step * 0.5 );
		series.forEach( function ( d, i ) {
			if ( d.ads > 0 ) {
				el( 'rect', { x: x( i ) - bw / 2, y: yA( d.ads ), width: bw, height: pad.t + ih - yA( d.ads ), rx: 2, class: 'vsen-chart__bar' }, svg );
			}
			if ( d.fraud > 0 ) {
				el( 'rect', { x: x( i ) - bw / 2, y: yA( d.fraud ), width: bw, height: pad.t + ih - yA( d.fraud ), rx: 2, class: 'vsen-chart__bar vsen-chart__bar--fraud' }, svg );
			}
		} );

		// Lines.
		[ 'pageviews', 'visitors' ].forEach( function ( key ) {
			var points = series.map( function ( d, i ) {
				return x( i ) + ',' + yT( d[ key ] );
			} );
			if ( 'pageviews' === key ) {
				el( 'polygon', { points: x( 0 ) + ',' + ( pad.t + ih ) + ' ' + points.join( ' ' ) + ' ' + x( n - 1 ) + ',' + ( pad.t + ih ), class: 'vsen-chart__area' }, svg );
			}
			el( 'polyline', { points: points.join( ' ' ), class: 'vsen-chart__line vsen-chart__line--' + key }, svg );
		} );

		// Hover.
		var cursor = el( 'line', { y1: pad.t, y2: pad.t + ih, class: 'vsen-chart__cursor', visibility: 'hidden' }, svg );
		var tip = document.createElement( 'div' );
		tip.className = 'vsen-chart__tip';
		tip.hidden = true;
		host.appendChild( svg );
		host.appendChild( tip );

		svg.addEventListener( 'mousemove', function ( event ) {
			var box = svg.getBoundingClientRect();
			var px = ( ( event.clientX - box.left ) / box.width ) * W;
			var i = Math.max( 0, Math.min( n - 1, Math.floor( ( px - pad.l ) / step ) ) );
			var d = series[ i ];
			cursor.setAttribute( 'x1', x( i ) );
			cursor.setAttribute( 'x2', x( i ) );
			cursor.setAttribute( 'visibility', 'visible' );
			tip.hidden = false;
			tip.textContent = '';
			var title = document.createElement( 'strong' );
			title.textContent = d.label;
			tip.appendChild( title );
			[
				[ 'pageviews', t.pageviews ],
				[ 'visitors', t.visitors ],
				[ 'ads', t.ads ],
				[ 'fraud', t.fraud ],
			].forEach( function ( row ) {
				var line = document.createElement( 'span' );
				line.className = 'vsen-chart__tip-row vsen-chart__tip-row--' + row[ 0 ];
				line.textContent = row[ 1 ] + ': ' + fmt( d[ row[ 0 ] ] );
				tip.appendChild( line );
			} );
			var left = ( x( i ) / W ) * box.width;
			tip.style.left = Math.min( box.width - 160, Math.max( 0, left + 12 ) ) + 'px';
		} );
		svg.addEventListener( 'mouseleave', function () {
			cursor.setAttribute( 'visibility', 'hidden' );
			tip.hidden = true;
		} );
	}

	// -------------------------------------------------------------------------------------------
	// Live visitors.
	// -------------------------------------------------------------------------------------------

	function renderLive( data ) {
		var list = document.getElementById( 'vsen-live' );
		var count = document.getElementById( 'vsen-live-count' );
		if ( ! list || ! data ) {
			return;
		}
		count.textContent = fmt( data.count );
		list.textContent = '';
		if ( ! data.sessions.length ) {
			var empty = document.createElement( 'li' );
			empty.className = 'vsen-muted';
			empty.textContent = t.nobody;
			list.appendChild( empty );
			return;
		}
		data.sessions.forEach( function ( s ) {
			var li = document.createElement( 'li' );
			var a = document.createElement( 'a' );
			a.href = s.link;
			a.className = 'vsen-ip';
			a.textContent = ( s.flag ? s.flag + ' ' : '' ) + s.ip;
			li.appendChild( a );
			if ( s.paid ) {
				var paid = document.createElement( 'span' );
				paid.className = 'vsen-pill vsen-pill--paid';
				paid.textContent = t.paid;
				li.appendChild( document.createTextNode( ' ' ) );
				li.appendChild( paid );
			}
			if ( s.score >= 40 ) {
				var badge = document.createElement( 'span' );
				badge.className = 'vsen-badge ' + ( s.score >= 70 ? 'vsen-badge--fraud' : 'vsen-badge--suspicious' );
				badge.textContent = s.score;
				li.appendChild( document.createTextNode( ' ' ) );
				li.appendChild( badge );
			}
			var meta = document.createElement( 'span' );
			meta.className = 'vsen-live__meta';
			meta.textContent = s.url + ' · ' + s.device + ' · ' + ( t.ago || '%s' ).replace( '%s', s.ago );
			li.appendChild( meta );
			list.appendChild( li );
		} );
	}

	function pollLive() {
		if ( ! document.getElementById( 'vsen-live' ) || ! cfg.liveUrl || ! window.fetch ) {
			return;
		}
		var load = function () {
			if ( document.hidden ) {
				return;
			}
			window
				.fetch( cfg.liveUrl, { credentials: 'same-origin', headers: { 'X-WP-Nonce': cfg.nonce } } )
				.then( function ( r ) {
					return r.ok ? r.json() : null;
				} )
				.then( renderLive )
				.catch( function () {} );
		};
		load();
		setInterval( load, 30000 );
	}

	// -------------------------------------------------------------------------------------------
	// Confirm prompts.
	// -------------------------------------------------------------------------------------------

	document.addEventListener( 'click', function ( event ) {
		var link = event.target.closest && event.target.closest( '[data-vsen-confirm]' );
		if ( link && ! window.confirm( t.confirm ) ) {
			event.preventDefault();
		}
	} );

	document.addEventListener( 'DOMContentLoaded', function () {
		var chart = document.getElementById( 'vsen-chart' );
		if ( chart ) {
			drawChart( chart );
		}
		pollLive();
	} );
} )();
