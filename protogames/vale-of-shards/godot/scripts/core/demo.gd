## The input alphabet of recorded routes and demos (tests/route.gd writes indices into it).
extends RefCounted

const INPUTS := [
	{}, {"dx": 1}, {"dx": -1}, {"fire2": true}, {"fire2": true, "dx": 1}, {"fire2": true, "dx": -1},
	{"dy": -1}, {"dy": 1}, {"fire1": true}, {"fire2": true, "dy": 1}]
