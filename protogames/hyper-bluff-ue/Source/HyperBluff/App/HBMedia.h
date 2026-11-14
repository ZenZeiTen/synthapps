// Hyper Bluff!! app layer: the two file decoders the game needs at run time, in plain C++
// so they are tested on Linux against the real assets (tests/app/test_media.cpp):
//  - PNG (8-bit grey, grey+alpha, RGB, RGBA, palette; not interlaced) to BGRA8, the byte
//    order of Unreal's PF_B8G8R8A8 textures. Includes a zlib inflater.
//  - WAV (RIFF, PCM 16-bit, mono or stereo) to its interleaved samples.
#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace hb {
namespace app {

struct Image {
    int w = 0;
    int h = 0;
    std::vector<uint8_t> bgra;  // w * h * 4 bytes, rows top to bottom
};

// False with `error` set on anything unsupported or malformed.
bool DecodePng(const uint8_t* data, size_t size, Image& out, std::string& error);

// zlib stream (RFC 1950/1951) to bytes; false on a malformed stream.
bool Inflate(const uint8_t* data, size_t size, std::vector<uint8_t>& out);

struct Wav {
    int channels = 0;
    int sample_rate = 0;
    std::vector<uint8_t> pcm;  // 16-bit little-endian interleaved samples, as in the file
};

bool DecodeWav(const uint8_t* data, size_t size, Wav& out, std::string& error);

}  // namespace app
}  // namespace hb
