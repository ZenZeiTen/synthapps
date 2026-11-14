#include "HBMedia.h"

#include <cstring>

namespace hb {
namespace app {

// ---- inflate (RFC 1951) ----------------------------------------------------------------------

namespace {

struct BitIn {
    const uint8_t* p;
    size_t n;
    size_t pos = 0;
    uint32_t bitbuf = 0;
    int bitcnt = 0;
    bool bad = false;
    int Bits(int need) {
        uint32_t v = bitbuf;
        while (bitcnt < need) {
            if (pos >= n) {
                bad = true;
                return 0;
            }
            v |= static_cast<uint32_t>(p[pos++]) << bitcnt;
            bitcnt += 8;
        }
        bitbuf = v >> need;
        bitcnt -= need;
        return static_cast<int>(v & ((1u << need) - 1u));
    }
};

struct Huff {
    short count[16];
    short symbol[288];
};

// Canonical Huffman table from code lengths. Returns false for an over-subscribed set.
bool MediaBuild(Huff& h, const short* length, int n) {
    std::memset(h.count, 0, sizeof(h.count));
    for (int s = 0; s < n; ++s) h.count[length[s]]++;
    if (h.count[0] == n) return true;
    int left = 1;
    for (int len = 1; len < 16; ++len) {
        left <<= 1;
        left -= h.count[len];
        if (left < 0) return false;
    }
    short offs[16];
    offs[1] = 0;
    for (int len = 1; len < 15; ++len) offs[len + 1] = static_cast<short>(offs[len] + h.count[len]);
    for (int s = 0; s < n; ++s) {
        if (length[s] != 0) h.symbol[offs[length[s]]++] = static_cast<short>(s);
    }
    return true;
}

int MediaDecode(BitIn& in, const Huff& h) {
    int code = 0, first = 0, index = 0;
    for (int len = 1; len < 16; ++len) {
        code |= in.Bits(1);
        if (in.bad) return -1;
        const int count = h.count[len];
        if (code - count < first) return h.symbol[index + (code - first)];
        index += count;
        first += count;
        first <<= 1;
        code <<= 1;
    }
    return -1;
}

const short kLBase[29] = {3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31,
                          35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258};
const short kLExt[29] = {0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0};
const short kDBase[30] = {1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193,
                          257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577};
const short kDExt[30] = {0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13};

bool MediaCodes(BitIn& in, std::vector<uint8_t>& out, const Huff& lencode, const Huff& distcode) {
    while (true) {
        int sym = MediaDecode(in, lencode);
        if (sym < 0) return false;
        if (sym < 256) {
            out.push_back(static_cast<uint8_t>(sym));
        } else if (sym == 256) {
            return true;
        } else {
            sym -= 257;
            if (sym >= 29) return false;
            const int len = kLBase[sym] + in.Bits(kLExt[sym]);
            const int dsym = MediaDecode(in, distcode);
            if (dsym < 0 || dsym >= 30) return false;
            const size_t dist = static_cast<size_t>(kDBase[dsym] + in.Bits(kDExt[dsym]));
            if (in.bad || dist > out.size()) return false;
            const size_t from = out.size() - dist;
            for (int i = 0; i < len; ++i) out.push_back(out[from + static_cast<size_t>(i)]);
        }
    }
}

}  // namespace

bool Inflate(const uint8_t* data, size_t size, std::vector<uint8_t>& out) {
    if (size < 2 || (data[0] & 0x0F) != 8 || ((data[0] << 8) | data[1]) % 31 != 0 || (data[1] & 0x20)) return false;
    BitIn in{data + 2, size - 2};
    int last = 0;
    do {
        last = in.Bits(1);
        const int type = in.Bits(2);
        if (in.bad) return false;
        if (type == 0) {
            in.bitbuf = 0;
            in.bitcnt = 0;
            if (in.pos + 4 > in.n) return false;
            const size_t len = static_cast<size_t>(in.p[in.pos] | (in.p[in.pos + 1] << 8));
            const size_t nlen = static_cast<size_t>(in.p[in.pos + 2] | (in.p[in.pos + 3] << 8));
            in.pos += 4;
            if (len != (~nlen & 0xFFFFu) || in.pos + len > in.n) return false;
            out.insert(out.end(), in.p + in.pos, in.p + in.pos + len);
            in.pos += len;
        } else if (type == 1) {
            static Huff fl, fd;
            static bool built = false;
            if (!built) {
                short l[288];
                int s = 0;
                for (; s < 144; ++s) l[s] = 8;
                for (; s < 256; ++s) l[s] = 9;
                for (; s < 280; ++s) l[s] = 7;
                for (; s < 288; ++s) l[s] = 8;
                MediaBuild(fl, l, 288);
                for (s = 0; s < 30; ++s) l[s] = 5;
                MediaBuild(fd, l, 30);
                built = true;
            }
            if (!MediaCodes(in, out, fl, fd)) return false;
        } else if (type == 2) {
            const int nlen = in.Bits(5) + 257, ndist = in.Bits(5) + 1, ncode = in.Bits(4) + 4;
            if (in.bad || nlen > 286 || ndist > 30) return false;
            static const short order[19] = {16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15};
            short lengths[320];
            std::memset(lengths, 0, sizeof(lengths));
            for (int i = 0; i < ncode; ++i) lengths[order[i]] = static_cast<short>(in.Bits(3));
            Huff lc, dc;
            if (!MediaBuild(lc, lengths, 19)) return false;
            int idx = 0;
            while (idx < nlen + ndist) {
                int sym = MediaDecode(in, lc);
                if (sym < 0) return false;
                if (sym < 16) {
                    lengths[idx++] = static_cast<short>(sym);
                } else {
                    short len = 0;
                    int rep = 0;
                    if (sym == 16) {
                        if (idx == 0) return false;
                        len = lengths[idx - 1];
                        rep = 3 + in.Bits(2);
                    } else if (sym == 17) {
                        rep = 3 + in.Bits(3);
                    } else {
                        rep = 11 + in.Bits(7);
                    }
                    if (in.bad || idx + rep > nlen + ndist) return false;
                    while (rep--) lengths[idx++] = len;
                }
            }
            if (lengths[256] == 0) return false;
            if (!MediaBuild(lc, lengths, nlen) || !MediaBuild(dc, lengths + nlen, ndist)) return false;
            if (!MediaCodes(in, out, lc, dc)) return false;
        } else {
            return false;
        }
    } while (!last);
    return true;
}

// ---- PNG -------------------------------------------------------------------------------------

namespace {
uint32_t MediaBE32(const uint8_t* p) {
    return (static_cast<uint32_t>(p[0]) << 24) | (static_cast<uint32_t>(p[1]) << 16) |
           (static_cast<uint32_t>(p[2]) << 8) | static_cast<uint32_t>(p[3]);
}
int MediaPaeth(int a, int b, int c) {
    const int p = a + b - c;
    const int pa = p > a ? p - a : a - p, pb = p > b ? p - b : b - p, pc = p > c ? p - c : c - p;
    if (pa <= pb && pa <= pc) return a;
    return pb <= pc ? b : c;
}
}  // namespace

bool DecodePng(const uint8_t* data, size_t size, Image& out, std::string& error) {
    static const uint8_t sig[8] = {137, 80, 78, 71, 13, 10, 26, 10};
    if (size < 8 || std::memcmp(data, sig, 8) != 0) {
        error = "not a PNG";
        return false;
    }
    size_t pos = 8;
    uint32_t w = 0, h = 0;
    int depth = 0, ctype = -1, interlace = 0;
    std::vector<uint8_t> idat, plte, trns;
    while (pos + 8 <= size) {
        const uint32_t len = MediaBE32(data + pos);
        const uint8_t* type = data + pos + 4;
        if (pos + 12 + len > size) {
            error = "truncated chunk";
            return false;
        }
        const uint8_t* body = data + pos + 8;
        if (std::memcmp(type, "IHDR", 4) == 0 && len >= 13) {
            w = MediaBE32(body);
            h = MediaBE32(body + 4);
            depth = body[8];
            ctype = body[9];
            interlace = body[12];
        } else if (std::memcmp(type, "PLTE", 4) == 0) {
            plte.assign(body, body + len);
        } else if (std::memcmp(type, "tRNS", 4) == 0) {
            trns.assign(body, body + len);
        } else if (std::memcmp(type, "IDAT", 4) == 0) {
            idat.insert(idat.end(), body, body + len);
        } else if (std::memcmp(type, "IEND", 4) == 0) {
            break;
        }
        pos += 12 + len;
    }
    int ch = 0;
    switch (ctype) {
        case 0: ch = 1; break;
        case 2: ch = 3; break;
        case 3: ch = 1; break;
        case 4: ch = 2; break;
        case 6: ch = 4; break;
        default: error = "unsupported colour type"; return false;
    }
    if (depth != 8 || interlace != 0 || w == 0 || h == 0 || w > 16384 || h > 16384) {
        error = "only 8-bit, non-interlaced PNGs are supported";
        return false;
    }
    std::vector<uint8_t> raw;
    raw.reserve(static_cast<size_t>(h) * (w * static_cast<uint32_t>(ch) + 1));
    if (!Inflate(idat.data(), idat.size(), raw)) {
        error = "bad zlib data";
        return false;
    }
    const size_t stride = static_cast<size_t>(w) * static_cast<size_t>(ch);
    if (raw.size() < static_cast<size_t>(h) * (stride + 1)) {
        error = "short image data";
        return false;
    }
    std::vector<uint8_t> px(static_cast<size_t>(h) * stride);
    for (size_t y = 0; y < h; ++y) {
        const uint8_t f = raw[y * (stride + 1)];
        const uint8_t* src = &raw[y * (stride + 1) + 1];
        uint8_t* dst = &px[y * stride];
        const uint8_t* up = y > 0 ? &px[(y - 1) * stride] : nullptr;
        for (size_t i = 0; i < stride; ++i) {
            const int a = i >= static_cast<size_t>(ch) ? dst[i - static_cast<size_t>(ch)] : 0;
            const int b = up ? up[i] : 0;
            const int c = (up && i >= static_cast<size_t>(ch)) ? up[i - static_cast<size_t>(ch)] : 0;
            int v = src[i];
            switch (f) {
                case 0: break;
                case 1: v += a; break;
                case 2: v += b; break;
                case 3: v += (a + b) / 2; break;
                case 4: v += MediaPaeth(a, b, c); break;
                default: error = "bad filter"; return false;
            }
            dst[i] = static_cast<uint8_t>(v & 0xFF);
        }
    }
    out.w = static_cast<int>(w);
    out.h = static_cast<int>(h);
    out.bgra.assign(static_cast<size_t>(w) * h * 4, 0);
    for (size_t i = 0; i < static_cast<size_t>(w) * h; ++i) {
        uint8_t r = 0, g = 0, b = 0, a = 255;
        const uint8_t* s = &px[i * static_cast<size_t>(ch)];
        if (ctype == 0) {
            r = g = b = s[0];
        } else if (ctype == 4) {
            r = g = b = s[0];
            a = s[1];
        } else if (ctype == 2) {
            r = s[0];
            g = s[1];
            b = s[2];
        } else if (ctype == 6) {
            r = s[0];
            g = s[1];
            b = s[2];
            a = s[3];
        } else {
            const size_t k = s[0];
            if (k * 3 + 2 >= plte.size()) {
                error = "palette index out of range";
                return false;
            }
            r = plte[k * 3];
            g = plte[k * 3 + 1];
            b = plte[k * 3 + 2];
            if (k < trns.size()) a = trns[k];
        }
        out.bgra[i * 4] = b;
        out.bgra[i * 4 + 1] = g;
        out.bgra[i * 4 + 2] = r;
        out.bgra[i * 4 + 3] = a;
    }
    return true;
}

// ---- WAV -------------------------------------------------------------------------------------

bool DecodeWav(const uint8_t* data, size_t size, Wav& out, std::string& error) {
    if (size < 12 || std::memcmp(data, "RIFF", 4) != 0 || std::memcmp(data + 8, "WAVE", 4) != 0) {
        error = "not a RIFF WAVE file";
        return false;
    }
    size_t pos = 12;
    bool have_fmt = false;
    int format = 0, bits = 0;
    while (pos + 8 <= size) {
        const uint8_t* id = data + pos;
        const size_t len = static_cast<size_t>(data[pos + 4] | (data[pos + 5] << 8) | (data[pos + 6] << 16)) |
                           (static_cast<size_t>(data[pos + 7]) << 24);
        const size_t body = pos + 8;
        const size_t avail = body + len <= size ? len : size - body;  // tolerate a short last chunk
        if (std::memcmp(id, "fmt ", 4) == 0 && avail >= 16) {
            format = data[body] | (data[body + 1] << 8);
            out.channels = data[body + 2] | (data[body + 3] << 8);
            out.sample_rate = data[body + 4] | (data[body + 5] << 8) | (data[body + 6] << 16) | (data[body + 7] << 24);
            bits = data[body + 14] | (data[body + 15] << 8);
            have_fmt = true;
        } else if (std::memcmp(id, "data", 4) == 0) {
            if (!have_fmt) {
                error = "data before fmt";
                return false;
            }
            out.pcm.assign(data + body, data + body + (avail & ~static_cast<size_t>(1)));
        }
        pos = body + len + (len & 1);
    }
    if (!have_fmt || format != 1 || bits != 16 || (out.channels != 1 && out.channels != 2) || out.sample_rate <= 0) {
        error = "only 16-bit PCM mono or stereo is supported";
        return false;
    }
    if (out.pcm.empty()) {
        error = "no data chunk";
        return false;
    }
    return true;
}

}  // namespace app
}  // namespace hb
