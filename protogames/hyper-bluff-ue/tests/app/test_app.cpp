// Linux runner for the app layer (Source/HyperBluff/App): the same object the Unreal build
// uses, driven through the same entry points (the harness command language, KeyDown/KeyUp,
// MouseClick) with an in-memory host. Ports every check of hyper-bluff/godot/tests/harness.sh
// plus the Director's Cut checks, the text-fit checks with real data, input repeat and
// held-button checks, the letterbox maths and the PNG/WAV decoders on the real assets.
//
// Usage: test_app <path to hyper-bluff-ue>   (ONLY=regex runs matching checks)
// Prints "ok   name" / "FAIL name" and ends with "APP TESTS n/n passed".
#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <functional>
#include <map>
#include <regex>
#include <sstream>
#include <string>
#include <vector>

#include "HBApp.h"
#include "HBCards.h"
#include "HBData.h"
#include "HBJam.h"
#include "HBMedia.h"

using namespace hb;
using namespace hb::app;

static std::string g_root;
static int g_pass = 0, g_total = 0;
static std::vector<std::string> g_failed;

static bool ReadFileBytes(const std::string& path, std::vector<uint8_t>& out) {
    std::ifstream f(path, std::ios::binary);
    if (!f) return false;
    out.assign(std::istreambuf_iterator<char>(f), std::istreambuf_iterator<char>());
    return true;
}
static std::string ReadFileText(const std::string& path) {
    std::vector<uint8_t> b;
    ReadFileBytes(path, b);
    return std::string(b.begin(), b.end());
}

struct TestHost : Host {
    std::map<std::string, std::string> files;
    std::vector<std::string> prints, sfx, musics;
    bool quit = false;
    bool ReadText(const std::string& n, std::string& out) override {
        auto it = files.find(n);
        if (it == files.end()) return false;
        out = it->second;
        return true;
    }
    bool WriteText(const std::string& n, const std::string& t) override {
        files[n] = t;
        return true;
    }
    void RemoveFile(const std::string& n) override { files.erase(n); }
    bool HasFile(const std::string& n) override { return files.count(n) > 0; }
    void PlaySfx(const std::string& n) override { sfx.push_back(n); }
    void PlayMusic(const std::string& n) override { musics.push_back(n); }
    void ApplyVolume(int, int) override {}
    void SetFullscreen(bool) override {}
    void Print(const std::string& l) override { prints.push_back(l); }
    void Quit() override { quit = true; }
    int64_t NowSeed() override { return 99; }
};

struct ArtCache {
    std::vector<Image> img;
    std::string portraits, sheets;
    bool loaded = false;
};
static ArtCache g_art;

static void LoadArt() {
    if (g_art.loaded) return;
    g_art.img.resize(kTexCount);
    for (int i = 0; i < kTexCount; ++i) {
        std::vector<uint8_t> b;
        std::string err;
        const std::string path = g_root + "/Content/Raw/Art/" + TexFile(static_cast<Tex>(i));
        if (!ReadFileBytes(path, b) || !DecodePng(b.data(), b.size(), g_art.img[static_cast<size_t>(i)], err)) {
            std::printf("cannot load %s: %s\n", path.c_str(), err.c_str());
            std::exit(2);
        }
    }
    g_art.portraits = ReadFileText(g_root + "/Content/Raw/Art/portraits.json");
    g_art.sheets = ReadFileText(g_root + "/Content/Raw/Art/sheets.json");
    g_art.loaded = true;
}

static void Setup(App& app, TestHost& host, bool harness, const std::string& script) {
    LoadArt();
    app.Init(&host, harness, script);
    for (int i = 0; i < kTexCount; ++i) {
        app.SetTextureSize(static_cast<Tex>(i), g_art.img[static_cast<size_t>(i)].w, g_art.img[static_cast<size_t>(i)].h);
    }
    app.SetArtMeta(g_art.portraits, g_art.sheets);
}

// Run a harness script to its end; returns the DUMP lines (without "DUMP ") joined by ';'.
static std::string RunScript(const std::string& script, std::string* problems = nullptr, TestHost* keep = nullptr) {
    TestHost local;
    TestHost& host = keep ? *keep : local;
    App app;
    Setup(app, host, true, script);
    for (int frame = 0; frame < 200000 && !host.quit; ++frame) app.Frame(1.0 / 60.0);
    std::string got;
    for (const std::string& l : host.prints) {
        if (l.rfind("DUMP ", 0) == 0) got += l.substr(5) + ";";
        if (problems && l.rfind("HARNESS", 0) == 0) *problems += l + " ";
    }
    if (problems && !host.quit) *problems += "script never ended ";
    return got;
}

static bool Selected(const std::string& name) {
    const char* only = std::getenv("ONLY");
    return !only || std::regex_search(name, std::regex(only));
}

static void Report(const std::string& name, bool ok, const std::string& detail = "") {
    ++g_total;
    if (ok) {
        ++g_pass;
        std::printf("ok   %s\n", name.c_str());
    } else {
        g_failed.push_back(name);
        std::printf("FAIL %s\n%s\n", name.c_str(), detail.c_str());
    }
}

// Every Run() check, written to tests/harness_checks.tsv for tools/harness.ps1 (Windows).
struct HarnessCheck {
    std::string name, want, script;
};
static std::vector<HarnessCheck> g_checks;

// harness.sh's run(): name, ERE over the joined DUMP lines, script.
static void Run(const std::string& name, const std::string& want, const std::string& script) {
    g_checks.push_back({name, want, script});
    if (!Selected(name)) return;
    std::string problems;
    const std::string got = RunScript(script, &problems);
    if (!problems.empty()) {
        Report(name, false, "  " + problems + "\n  got:  " + got);
        return;
    }
    const bool ok = std::regex_search(got, std::regex(want, std::regex::extended));
    Report(name, ok, "  got:  " + got + "\n  want: " + want);
}

static void Check(const std::string& name, const std::function<std::string()>& body) {
    if (!Selected(name)) return;
    const std::string err = body();
    Report(name, err.empty(), "  " + err);
}

// --shot <script> <out.txt>: run a harness script, then write the final frame's draw list
// (one command per line) for tests/app/shot.py to composite into a PNG. For looking, not checking.
static int Shot(const std::string& script, const std::string& out) {
    TestHost host;
    App app;
    Setup(app, host, true, script);
    for (int frame = 0; frame < 200000 && !host.quit; ++frame) app.Frame(1.0 / 60.0);
    std::ofstream f(out);
    for (const DrawCmd& d : app.Render()) {
        f << d.tex << ' ' << d.x << ' ' << d.y << ' ' << d.w << ' ' << d.h << ' ' << d.u << ' ' << d.v << ' ' << d.uw << ' '
          << d.vh << ' ' << d.col.r << ' ' << d.col.g << ' ' << d.col.b << ' ' << d.col.a << '\n';
    }
    for (const std::string& l : app.FitFail()) std::printf("fit: %s\n", l.c_str());
    return 0;
}

int main(int argc, char** argv) {
    g_root = argc > 1 ? argv[1] : ".";
    if (argc > 4 && std::string(argv[2]) == "--shot") return Shot(argv[3], argv[4]);
    const std::string SKIP = "wait:16,tap:ok,tap:ok";
    const std::string SKIP3 = SKIP + "," + SKIP + "," + SKIP;
    const std::string SKIP4 = SKIP3 + "," + SKIP;
    const std::string SKIP5 = SKIP4 + "," + SKIP;
    // 5 opening pages, then Pochi's lore (2) and intro (2)
    const std::string TO_PLAY = "until:title:60,tap:ok,until:avatar:60,tap:ok,until:story:60," + SKIP5 + ",until:versus:60," +
                                SKIP4 + ",until:play:60";
    const std::string CLICK2 = "wait:16,click:next,click:next";

    // ---- the checks of hyper-bluff/godot/tests/harness.sh, same names, same regexes ----------
    Run("title to first hand with the keyboard",
        "^screen=title .*music=title .*;screen=avatar .*;screen=story .*page=0/5 .*save=1 .*;screen=versus .*rival=pochi .*music=match .*;screen=play .*phase=bet hand=1 .*to_act=0 pot=30 stack=790/780 .*",
        "until:title:60,dump,tap:ok,until:avatar:60,dump,tap:ok,until:story:60,dump," + SKIP5 + ",until:versus:60,dump," + SKIP4 +
            ",until:play:60,until:mine:900,dump");
    Run("the same path with mouse clicks only",
        "^screen=avatar cur=0 .*;screen=avatar cur=2 .*;screen=story .*;screen=play .*phase=bet hand=1 .*;screen=play .*(street=1|to_act=1|phase=(advance|showdown|hand_over)).*",
        "until:title:60,click:menu:0,until:avatar:60,dump,click:avatar:2,wait:2,dump,click:avatar:2,until:story:60,dump," + CLICK2 +
            "," + CLICK2 + "," + CLICK2 + "," + CLICK2 + "," + CLICK2 + ",until:versus:60," + CLICK2 + "," + CLICK2 + "," + CLICK2 + "," +
            CLICK2 + ",until:play:60,until:mine:900,dump,click:btn:1,wait:3,dump");
    Run("a held confirm does not carry into the next screen", "^screen=avatar cur=0 .*",
        "until:title:60,tap:ok,tap:ok,tap:ok,wait:40,dump");
    Run("cursor answers on the same step as the press",
        "^screen=play .*btn=1 .*;screen=play .*btn=2 .*;screen=play .*btn=0 .*",
        TO_PLAY + ",until:mine:900,dump,tap:right,dump,tap:right,dump");
    Run("cards slide in from the deck, then settle", "^screen=play .*hand=1 .*moving=[1-4] .*;screen=play .*moving=0 .*",
        TO_PLAY + ",wait:75,dump,until:mine:900,wait:40,dump");
    Run("relaxed pace: the rival takes over half a second to answer a call",
        "^screen=play .*pot=40 .*fliers=[1-9].*;screen=play .*street=0 to_act=1 pot=40 .*pace=RELAXED.*;screen=play .*(street=1|phase=(advance|showdown|hand_over)|pot=([5-9][0-9]|[1-9][0-9][0-9]+)).*",
        TO_PLAY + ",until:mine:900,key:C,wait:3,dump,wait:37,dump,wait:400,dump");
    Run("fast pace from the options menu shortens the rival's pause",
        "^screen=options .*pace=FAST.*;screen=play .*(street=1|phase=(advance|showdown|hand_over)|pot=([5-9][0-9]|[1-9][0-9][0-9]+)).*pace=FAST.*",
        TO_PLAY + ",until:mine:900,tap:pause,wait:14,tap:down,tap:ok,wait:14,tap:down,tap:down,tap:left,dump,tap:cancel,wait:14,tap:cancel,wait:14,key:C,wait:40,dump");
    Run("each floor has its own room",
        "^screen=play .*rival=pochi .*room=bg_floor1 .*;screen=play .*rival=tetsu .*room=bg_floor1 .*;screen=play .*rival=goro .*room=bg_floor2 .*;screen=play .*rival=yuki .*room=bg_floor3 .*;screen=play .*rival=zeno .*room=bg_floor4 .*;screen=play .*rival=onyx .*room=bg_floor5 .*",
        TO_PLAY + ",dump,floor:1,dump,floor:2,dump,floor:4,dump,floor:6,dump,floor:8,dump");
    Run("fold key gives up the blind", "^screen=play .*phase=hand_over hand=1 .*stack=790/810 .*sfx=(fold|lose_hand).*",
        TO_PLAY + ",until:mine:900,key:F,until:over:2500,dump");
    Run("raise sizes: arrows and wheel step the amount, R commits it",
        "^screen=play .*pot=30 .*btn=1 .*;screen=play .*btn=2 .*;screen=play .*(pot=(8[0-9]|9[0-9]|[1-9][0-9][0-9]+)|phase=(hand_over|showdown|advance)).*",
        TO_PLAY + ",until:mine:900,dump,tap:up,wheel:up,dump,key:R,wait:3,dump");
    Run("all-in from the top raise size ends with a showdown or a fold", "^screen=play .*phase=(hand_over|match_over) .*",
        TO_PLAY + ",until:mine:900,tap:up,tap:up,tap:up,tap:up,tap:up,tap:up,tap:raise,until:over:2500,dump");
    Run("power keys spend a power and show the cut-in; pad button works too",
        "^screen=play .*powers=3/0 .*;screen=play .*powers=2/0 .*sfx=(powerup|cutin).*;screen=play .*powers=1/0 .*",
        TO_PLAY + ",until:mine:900,give:hawk+guard+over,dump,key:1,wait:2,dump,until:mine:900,pad:2,wait:2,dump");
    Run("a power that cannot be used is kept", "^screen=play .*powers=1/0 .*sfx=error.*",
        TO_PLAY + ",until:mine:900,give:hawk,key:1,until:mine:900,give:hawk,key:1,until:mine:900,give:hawk,key:1,wait:2,dump");
    Run("pause opens over the table, blocks play, and resumes",
        "^screen=pause .*;screen=pause .*phase=bet hand=1 .*pot=30 .*;screen=play .*pot=30 .*;screen=play .*phase=hand_over .*",
        TO_PLAY + ",until:mine:900,tap:pause,wait:14,dump,key:F,wait:5,dump,tap:pause,wait:14,dump,key:F,until:over:2500,dump");
    Run("pause during a cut-in keeps the hand intact", "^screen=pause .*powers=0/0 .*;screen=play .*phase=bet .*powers=0/0 .*",
        TO_PLAY + ",until:mine:900,give:guard,key:1,wait:3,tap:pause,wait:30,dump,tap:ok,wait:14,until:mine:900,dump");
    Run("options from the pause menu and back to the table",
        "^screen=options .*opts=7/8.*;screen=options .*opts=5/8.*;screen=pause .*;screen=play .*",
        TO_PLAY + ",until:mine:900,tap:pause,wait:14,tap:down,tap:ok,wait:14,dump,tap:left,tap:left,dump,tap:cancel,wait:14,dump,tap:cancel,wait:14,dump");
    Run("quit to title keeps the run; continue resumes the same floor",
        "^screen=title .*save=1 .*;screen=versus .*rival=pochi .*;screen=play .*hand=1 .*",
        TO_PLAY + ",until:mine:900,tap:pause,wait:14,tap:up,tap:ok,until:title:60,dump,tap:down,tap:ok,until:versus:60,dump," + SKIP4 +
            ",until:play:60,until:mine:900,dump");
    Run("winning a floor: result, rival's last word, next rival",
        "^screen=play .*phase=match_over .*stack=1600/0 .*score=[1-9][0-9]+ .*winner=0.*;screen=matchend .*music=victory.*;screen=versus .*page=0/1 .*;screen=versus .*rival=tetsu .*powers=[0-9]/1 .*",
        TO_PLAY + ",rig:win,until:over:2500,dump,tap:ok,until:matchend:60,dump,tap:ok,until:versus:60,dump," + SKIP + ",until:versus:60,dump");
    Run("losing a floor: continue halves the score, same rival",
        "^screen=matchend .*score=4000 .*winner=1 .*music=defeat.*;screen=versus .*rival=pochi .*score=2000 .*",
        TO_PLAY + ",rig:lose,score:4000,until:over:2500,tap:ok,until:matchend:60,dump,tap:ok,until:versus:60,dump");
    Run("giving up records the score and returns to the title", "^screen=scores .*save=0 scores=1 .*;screen=title .*",
        TO_PLAY + ",rig:lose,until:over:2500,tap:ok,until:matchend:60,tap:down,tap:ok,until:scores:60,dump,tap:ok,until:title:60,dump");
    Run("mini-boss between floors: interlude header, short stacks, warden down",
        "^screen=versus .*page=0/3 .*rival=tetsu .*head=INTERLUDE:_THE_STAIRWELL.*;screen=play .*rival=tetsu .*stack=500/500 .*;screen=matchend .*rival=tetsu .*stack=1000/0 .*head=WARDEN_DOWN!!.*",
        TO_PLAY + ",rig:win,until:over:2500,tap:ok,until:matchend:60,tap:ok,until:versus:60," + SKIP +
            ",until:versus:60,wait:200,dump," + SKIP3 + ",until:play:60,dump,rig:win,until:over:2500,tap:ok,until:matchend:60,wait:5,dump");
    Run("boss floor gets its own scene and music",
        "^screen=story .*page=0/4 .*rival=onyx .*;screen=versus .*rival=onyx .*music=boss.*",
        TO_PLAY + ",floor:7,rig:win,until:over:2500,tap:ok,until:matchend:60,tap:ok,until:versus:60," + SKIP + ",until:story:60,dump," +
            SKIP4 + ",until:versus:60,dump");
    Run("beating the boss: ending, credits, score table, title again",
        "^screen=story .*page=0/5 .*phase=run_won .*music=ending.*save=0.*;screen=credits .*;screen=scores .*scores=1 .*;screen=title .*music=title.*;screen=avatar .*",
        TO_PLAY + ",floor:8,rig:win,until:over:2500,tap:ok,until:matchend:60,tap:ok,until:versus:60," + SKIP + ",until:story:60,dump," +
            SKIP5 + ",until:credits:60,dump,tap:ok,until:scores:60,dump,tap:ok,until:title:60,dump,tap:ok,until:avatar:60,dump");
    Run("credits also end by themselves", "^screen=scores .*scores=1 .*",
        TO_PLAY + ",floor:8,rig:win,until:over:2500,tap:ok,until:matchend:60,tap:ok,until:versus:60," + SKIP + ",until:story:60," + SKIP5 +
            ",until:credits:60,until:scores:2400,dump");
    Run("text stays inside its boxes on every screen",
        "^fit=0 ;fit=0 ;fit=0 ;fit=0 ;fit=0 ;fit=0 ;fit=0 ;fit=0 ;fit=0 ;fit=0 ;$",
        "until:title:60,fit,tap:ok,until:avatar:60,tap:left,fit,tap:ok,until:story:60,wait:200,fit," + SKIP5 +
            ",until:versus:60,wait:200,fit," + SKIP4 +
            ",until:play:60,until:mine:900,give:glare+sight+over,score:9999999,fit,floor:7,rig:win,fever,until:over:2500,fit,tap:ok,until:matchend:60,fit,tap:ok,until:versus:60,wait:200,fit," +
            SKIP + ",until:story:60,wait:200,fit,tap:pause,wait:2," + SKIP4 + ",until:versus:60,wait:200,fit");
    Run("text fits on the lost-floor, options, pause and score screens", "^fit=0 ;fit=0 ;fit=0 ;fit=0 ;fit=0 ;$",
        TO_PLAY + ",until:mine:900,tap:pause,wait:14,fit,tap:down,tap:ok,wait:14,fit,tap:cancel,wait:14,tap:ok,wait:14,rig:lose,score:9999999,key:F,until:over:2500,tap:ok,until:over:2500,fit,tap:ok,until:matchend:60,fit,tap:down,tap:ok,until:scores:60,fit");

    // ---- Director's Cut checks (also in tools/harness.ps1) ------------------------------------
    // Hand 1: fold. Hand 2: the player is the big blind and acts first after the flop.
    const std::string TO_FLOP2 = TO_PLAY + ",until:mine:900,key:F,until:over:2500,tap:ok,until:mine:900,key:C,until:mine:900";
    Run("retake: CUT! reshoots the flop with a clapperboard cut-in",
        "^screen=play .*street=1 .*powers=1/0 .*board=([2-9TJQKA][shdc],){2}[2-9TJQKA][shdc] cutin=- flyoff=0 .*;screen=play .*powers=0/0 .*sfx=powerup.*cutin=clap flyoff=3 .*;screen=play .*moving=[1-3] .*cutin=- .*",
        TO_FLOP2 + ",give:retake,dump,key:1,wait:1,dump,wait:110,dump");
    Check("retake: the new flop differs, old cards fly off, new ones deal in", [&]() -> std::string {
        TestHost host;
        App app;
        Setup(app, host, true, TO_FLOP2 + ",give:retake,wait:600");
        // run until the script parks on the long wait, at the player's flop turn
        for (int i = 0; i < 20000 && !(app.MyTurn() && app.run().street == 1 && app.run().powers[0].size() == 1 &&
                                        app.run().powers[0][0] == Power::Retake);
             ++i) {
            app.Step();
        }
        if (!app.MyTurn() || app.run().street != 1) return "never reached the player's flop turn";
        const std::vector<int> before = app.run().board;
        app.KeyDown("One");
        app.KeyUp("One");
        const std::vector<int> after = app.run().board;
        if (after == before) return "board unchanged";
        if (!app.cutin().on || !app.cutin().clap) return "no clapperboard cut-in";
        if (app.flyoffs().size() != 3) return "expected 3 cards flying off, got " + std::to_string(app.flyoffs().size());
        for (size_t i = 0; i < 3; ++i) {
            if (app.flyoffs()[i].card != before[i]) return "fly-off shows the wrong card";
        }
        int t_snap = -1, dealt = 0;
        size_t sfx0 = host.sfx.size();
        for (int i = 0; i < 200; ++i) {
            app.Step();
            for (size_t k = sfx0; k < host.sfx.size(); ++k) {
                if (host.sfx[k] == "cutin" && t_snap < 0) t_snap = i;
                if (host.sfx[k] == "card_deal") ++dealt;
            }
            sfx0 = host.sfx.size();
        }
        if (t_snap < 8 || t_snap > 14) return "clapper snap sound at tick " + std::to_string(t_snap) + ", want about 11";
        if (dealt != 3) return "expected 3 deal sounds for the new flop, got " + std::to_string(dealt);
        if (!app.flyoffs().empty()) return "fly-offs still alive";
        return "";
    });
    Run("retake cannot be used before the flop", "^screen=play .*street=0 .*powers=1/0 .*sfx=error.*cutin=- flyoff=0 .*",
        TO_PLAY + ",until:mine:900,give:retake,key:1,wait:2,dump");
    Run("episode titles: versus screens and the floor-clear teaser",
        "^screen=versus .*rival=pochi .*head=EPISODE_1:_THE_LOBBY_PIT .*;screen=matchend .*winner=0.*head=FLOOR_CLEARED!! .*;screen=versus .*rival=tetsu .*head=INTERLUDE:_THE_STAIRWELL .*;fit=0 ;",
        "until:title:60,tap:ok,until:avatar:60,tap:ok,until:story:60," + SKIP5 + ",until:versus:60,dump," + SKIP4 +
            ",until:play:60,rig:win,until:over:2500,tap:ok,until:matchend:60,dump,tap:ok,until:versus:60," + SKIP +
            ",until:versus:60,dump,fit");
    Check("episode titles: one per ladder match, all original and inside the screen", [&]() -> std::string {
        if (jam::LadderSize() != 9) return "ladder size " + std::to_string(jam::LadderSize());
        for (int m = 0; m <= jam::LadderSize(); ++m) {
            const std::string t = jam::EpisodeTitle(m);
            if (t.empty()) return "empty title for match " + std::to_string(m);
            if (t.size() * 12 > 640) return "label wider than the screen in the big font: " + t;
            if (jam::NextEpisodeLine(m).size() * 6 > 432) return "teaser wider than its panel: " + jam::NextEpisodeLine(m);
            if (m < jam::LadderSize() && jam::IsMiniBoss(m) != (m % 2 == 1)) return "warden order";
        }
        if (jam::EpisodeTitle(jam::LadderSize()) != "FINALE: CURTAIN CALL") return "ending title";
        if (jam::RoomIndex(1) != 0 || jam::RoomIndex(2) != 1) return "a warden plays in the room of the floor before";
        if (jam::RoomIndex(jam::LadderSize() - 1) != jam::kRooms - 1) return "final boss is not in the last room";
        return "";
    });
    Check("title shows the DIRECTOR'S CUT stamp", [&]() -> std::string {
        TestHost host;
        App app;
        Setup(app, host, false, "");
        for (int i = 0; i < 30; ++i) app.Step();
        const std::vector<DrawCmd>& d = app.Render();
        // the stamp's glyphs are font_big draws between y 150 and 220
        int glyphs = 0;
        for (const DrawCmd& c : d) {
            if (c.tex == static_cast<int>(Tex::FontBig) && c.y > 170 && c.y < 200) ++glyphs;
        }
        if (glyphs < 12) return "stamp glyphs: " + std::to_string(glyphs);
        if (!app.FitFail().empty()) return "fit: " + app.FitFail()[0];
        return "";
    });

    // ---- input: repeat, held buttons, mouse ------------------------------------------------------
    Check("a held arrow repeats after 0.4 s, every 5 ticks", [&]() -> std::string {
        TestHost host;
        App app;
        Setup(app, host, false, "");
        for (int i = 0; i < 20; ++i) app.Step();  // past the screen lock
        app.KeyDown("Down");
        if (app.cursor() != 1) return "first press did not move the cursor on the same step";
        std::vector<int> at;
        int last = app.cursor();
        for (int i = 1; i <= 40; ++i) {
            app.Step();
            if (app.cursor() != last) {
                at.push_back(i);
                last = app.cursor();
            }
        }
        app.KeyUp("Down");
        if (at.size() < 3 || at[0] != App::kRepeatDelay || at[1] - at[0] != App::kRepeatEvery) {
            std::string s;
            for (int v : at) s += std::to_string(v) + " ";
            return "repeat ticks: " + s;
        }
        return "";
    });
    Check("a held confirm key does not act on the next screen", [&]() -> std::string {
        TestHost host;
        App app;
        Setup(app, host, false, "");
        for (int i = 0; i < 20; ++i) app.Step();
        app.KeyDown("Z");  // NEW GAME -> avatar
        if (app.screen() != Screen::Avatar) return "Z did not open the avatar screen";
        for (int i = 0; i < 120; ++i) app.Step();  // keep holding: no new press reaches the avatar screen
        if (app.screen() != Screen::Avatar) return "held Z acted on the avatar screen";
        app.KeyUp("Z");
        return "";
    });
    Check("a held arrow does not repeat on the next screen", [&]() -> std::string {
        TestHost host;
        App app;
        Setup(app, host, false, "");
        for (int i = 0; i < 20; ++i) app.Step();
        app.KeyDown("Left");  // no effect on the title menu, but held
        app.KeyDown("Enter");
        app.KeyUp("Enter");  // NEW GAME -> avatar, Left still held
        for (int i = 0; i < 80; ++i) app.Step();
        if (app.cursor() != 0) return "held Left moved the avatar cursor to " + std::to_string(app.cursor());
        app.KeyUp("Left");
        for (int i = 0; i < 5; ++i) app.Step();
        app.KeyDown("Left");
        app.KeyUp("Left");
        if (app.cursor() != 3) return "a fresh press after release did not move";
        return "";
    });
    Check("every Unreal key name maps to its main.gd action", [&]() -> std::string {
        const std::pair<const char*, Act> want[] = {
            {"Up", Act::Up}, {"W", Act::Up}, {"S", Act::Down}, {"A", Act::Left}, {"D", Act::Right},
            {"Z", Act::Ok}, {"Enter", Act::Ok}, {"SpaceBar", Act::Ok}, {"X", Act::Cancel}, {"BackSpace", Act::Cancel},
            {"Escape", Act::Pause}, {"P", Act::Pause}, {"One", Act::Power1}, {"Two", Act::Power2}, {"Three", Act::Power3},
            {"F", Act::Fold}, {"C", Act::Call}, {"R", Act::Raise}, {"Gamepad_DPad_Up", Act::Up},
            {"Gamepad_FaceButton_Bottom", Act::Ok}, {"Gamepad_FaceButton_Right", Act::Cancel},
            {"Gamepad_Special_Right", Act::Pause}, {"Gamepad_FaceButton_Left", Act::Power1},
            {"Gamepad_FaceButton_Top", Act::Power2}, {"Gamepad_RightShoulder", Act::Power3},
            {"Gamepad_LeftShoulder", Act::Fold}};
        for (const auto& w : want) {
            if (ActForKey(w.first) != w.second) return std::string("wrong action for ") + w.first;
        }
        if (PadKeyName("2") != "Gamepad_FaceButton_Left" || KeyAlias("1") != "One") return "harness aliases";
        if (AllKeyNames().size() != 32) return "key table size " + std::to_string(AllKeyNames().size());
        return "";
    });
    Check("letterbox: integer scale, centred, mouse maps back", [&]() -> std::string {
        Layout l = ComputeLayout(1920, 1080);
        if (l.scale != 3 || l.off_x != 0 || l.off_y != 0) return "1920x1080";
        l = ComputeLayout(1366, 768);
        if (l.scale != 2 || l.off_x != 43 || l.off_y != 24) return "1366x768";
        l = ComputeLayout(500, 300);
        if (l.scale != 1) return "small window";
        Vec2 v;
        l = ComputeLayout(1366, 768);
        if (!ToVirtual(l, 43 + 2 * 320.5f, 24 + 2 * 231.0f, v) || v.x != 320.5f || v.y != 231.0f) return "map back";
        if (ToVirtual(l, 10, 10, v)) return "letterbox counted as inside";
        // a click mapped from screen pixels opens the menu item under it
        TestHost host;
        App app;
        Setup(app, host, false, "");
        for (int i = 0; i < 20; ++i) app.Step();
        const RectF r = app.MenuRect(0);
        ToVirtual(l, static_cast<float>(l.off_x) + (r.x + 5) * 2, static_cast<float>(l.off_y) + (r.y + 5) * 2, v);
        app.MouseClick(v);
        if (app.screen() != Screen::Avatar) return "click on NEW GAME did not open the avatar screen";
        return "";
    });
    Check("fixed 60 Hz tick: the same seconds give the same ticks at any frame rate", [&]() -> std::string {
        TestHost h1, h2;
        App a, b;
        Setup(a, h1, false, "");
        Setup(b, h2, false, "");
        for (int i = 0; i < 30; ++i) a.Frame(1.0 / 30.0);   // 1 s at 30 fps
        for (int i = 0; i < 144; ++i) b.Frame(1.0 / 144.0);  // 1 s at 144 fps
        if (a.tick() < 59 || a.tick() > 61 || b.tick() < 59 || b.tick() > 61) {
            return "ticks " + std::to_string(a.tick()) + " / " + std::to_string(b.tick());
        }
        return "";
    });
    Check("harness saves stay out of the player's files and start empty", [&]() -> std::string {
        TestHost host;
        host.files["run.sav"] = "player run";
        host.files["scores.sav"] = "9999 rin 5 1\n";
        host.files["harness/scores.sav"] = "123 rin 1 0\n";
        RunScript(TO_PLAY + ",rig:lose,until:over:2500,tap:ok,until:matchend:60,tap:down,tap:ok,until:scores:60,dump", nullptr, &host);
        if (host.files["run.sav"] != "player run" || host.files["scores.sav"] != "9999 rin 5 1\n") return "player files touched";
        const std::string hs = host.files["harness/scores.sav"];
        if (hs.find("123 rin") != std::string::npos) return "harness scores were not wiped at start";
        if (hs.empty()) return "harness score not written under harness/";
        return "";
    });

    // ---- text fit with the longest real data -----------------------------------------------------
    Check("story pages: every page of every cast and story fits 5 lines of 80", [&]() -> std::string {
        std::vector<std::vector<std::string>> all = {data::StoryOpen(), data::StoryBoss(), data::StoryEnd()};
        for (const CastEntry& c : data::Cast()) {
            std::vector<std::string> versus = c.lore;
            versus.insert(versus.end(), c.intro.begin(), c.intro.end());
            all.insert(all.end(), {versus, c.beaten});
            for (const std::string& l : c.gloat) {
                if (WrapText(l, 46).size() > 4) return "gloat too long for the panel: " + l;
            }
            for (const auto* v : {&c.win, &c.lose, &c.allin}) {
                for (const std::string& l : *v) {
                    if (WrapText(l, 38).size() > 3) return "bubble too long: " + l;
                }
            }
        }
        all.push_back({std::string(700, 'x') + " " + std::string(30, 'y')});  // synthetic: unbreakable word
        std::string long_page;
        for (int i = 0; i < 60; ++i) long_page += "word" + std::to_string(i) + " ";
        all.push_back({long_page});
        for (const auto& pages : all) {
            for (const std::string& p : PaginateStory(pages)) {
                const std::vector<std::string> lines = WrapText(p, kStoryChars);
                if (lines.size() > kStoryLines) return "page still has " + std::to_string(lines.size()) + " lines";
                for (const std::string& l : lines) {
                    if (l.size() > kStoryChars && l.find(' ') != std::string::npos) return "line too long: " + l;
                }
            }
        }
        if (PaginateStory({long_page}).size() < 2) return "a long page was not split";
        return "";
    });
    Check("speech bubbles, messages, tooltips and missions fit with every real string", [&]() -> std::string {
        TestHost host;
        App app;
        Setup(app, host, true, TO_PLAY + ",until:mine:900,wait:100000");
        for (int i = 0; i < 20000 && !app.MyTurn(); ++i) app.Step();
        if (!app.MyTurn()) return "never reached the table";
        std::vector<std::string> lines;
        for (const CastEntry& c : data::Cast()) {
            for (const auto* v : {&c.win, &c.lose, &c.allin, &c.gloat, &c.intro, &c.beaten}) lines.insert(lines.end(), v->begin(), v->end());
        }
        lines.push_back(std::string(500, 'a'));
        std::string words;
        for (int i = 0; i < 80; ++i) words += "longword ";
        lines.push_back(words);
        for (const std::string& l : lines) {
            app.TestShow(l, l, "");
            app.Render();
            if (!app.FitFail().empty()) return "bubble/message: " + app.FitFail()[0];
            // the bubble never grows past four lines (it must not cover the board at y 128)
            for (const DrawCmd& d : app.Render()) {
                if (d.tex == static_cast<int>(Tex::Font) && d.x >= 22 && d.x < 262 && d.y > 40 + 5 + 3 * 11 + 1 && d.y < 104 &&
                    d.col.r < 0.2f) {
                    return "bubble text below its fourth line: " + l.substr(0, 40);
                }
            }
        }
        State& s = app.run_mut();
        for (const MissionInfo& m : data::Missions()) {
            s.mission.id = m.id;
            s.mission.text = std::string(m.text) + " (" + data::kSuitName[2] + ")";
            app.Render();
            if (!app.FitFail().empty()) return "mission: " + app.FitFail()[0];
        }
        for (const PowerInfo& p : data::Powers()) {
            s.powers[0] = {p.id};
            app.TestShow("", "You use " + std::string(p.name) + ": " + p.desc, "power:0");
            app.Render();
            if (!app.FitFail().empty()) return "power tooltip: " + app.FitFail()[0];
        }
        return "";
    });
    Check("result panel holds every line with the most lines a hand can score", [&]() -> std::string {
        TestHost host;
        App app;
        Setup(app, host, true, TO_PLAY + ",rig:win,until:over:2500,wait:100000");
        for (int i = 0; i < 40000 && !(app.run().phase == Phase::MatchOver && app.wait() == 0); ++i) app.Step();
        if (app.run().phase != Phase::MatchOver) return "no result";
        for (int i = 0; i < 30; ++i) app.Step();
        Result& r = app.run_mut().result;
        r.showdown = true;
        r.lines.clear();
        for (const char* l : {"CHIPS WON", "ROYAL FLUSH", "BONUS: WIN WITH A FLUSH OF DIAMONDS", "STAR CARDS", "OVERDRIVE x2",
                              "FEVER x3", "FLOOR CLEAR BONUS"}) {
            r.lines.push_back({l, 9999999});
        }
        r.points = 99999999;
        r.guarded = true;
        r.power = Power::Retake;
        app.Render();
        if (!app.FitFail().empty()) return app.FitFail()[0];
        return "";
    });
    Check("the longest names, titles and scores fit on the avatar, versus and score screens", [&]() -> std::string {
        // every avatar on the avatar screen
        TestHost host;
        App app;
        Setup(app, host, false, "");
        for (int i = 0; i < 20; ++i) app.Step();
        app.Press(Act::Ok);
        for (int k = 0; k < 4; ++k) {
            for (int i = 0; i < 14; ++i) app.Step();
            app.Render();
            if (!app.FitFail().empty()) return "avatar: " + app.FitFail()[0];
            app.Press(Act::Right);
        }
        // every rival's versus screen and floor-clear screen
        for (int m = 0; m < jam::LadderSize(); ++m) {
            std::string problems;
            const std::string got = RunScript(TO_PLAY + ",floor:" + std::to_string(m) + ",score:99999999,rig:win,until:over:2500,tap:ok,until:matchend:60,fit,tap:ok,until:versus:60,wait:300,fit", &problems);
            if (!problems.empty()) return problems;
            if (got != "fit=0 ;fit=0 ;") return "match " + std::to_string(m) + ": " + got;
        }
        return "";
    });

    // ---- the decoders on the real assets --------------------------------------------------------
    Check("PNG decoder reads every staged image", [&]() -> std::string {
        LoadArt();
        // spot checks against the sizes the renderer relies on
        const std::pair<Tex, std::pair<int, int>> want[] = {{Tex::Font, {96, 54}}, {Tex::Cards, {520, 280}},
                                                            {Tex::Portraits, {480, 1248}}, {Tex::Floor1, {640, 360}}};
        for (const auto& w : want) {
            const Image& im = g_art.img[static_cast<size_t>(w.first)];
            if (im.w != w.second.first || im.h != w.second.second) return std::string("size of ") + TexFile(w.first);
        }
        // icons.png holds one 32 px cell per name in sheets.json, retake included
        if (g_art.sheets.find("\"retake\"") == std::string::npos) return "sheets.json has no retake icon";
        const Image& pt = g_art.img[static_cast<size_t>(Tex::Portraits)];
        const size_t o0 = g_art.portraits.find("\"order\"");
        const size_t o1 = g_art.portraits.find(']', o0);
        const size_t rows = static_cast<size_t>(std::count(g_art.portraits.begin() + static_cast<std::ptrdiff_t>(o0),
                                                           g_art.portraits.begin() + static_cast<std::ptrdiff_t>(o1), ',')) + 1;
        if (pt.h != 96 * static_cast<int>(rows)) return "portraits.png rows do not match portraits.json order";
        for (int m = 0; m < jam::LadderSize(); ++m) {
            if (g_art.portraits.find(std::string("\"") + jam::RivalId(m) + "\"") == std::string::npos) return "no portrait row for a rival";
        }
        const Image& ic = g_art.img[static_cast<size_t>(Tex::Icons)];
        if (ic.w % 32 != 0 || ic.w / 32 < 10) return "icons.png has " + std::to_string(ic.w / 32) + " cells";
        // a reference dump made by Python/PIL (tests/run_all.sh writes it)
        const char* ref = std::getenv("PNG_REF");
        if (ref) {
            std::ifstream f(ref);
            std::string name;
            unsigned long long sum = 0;
            while (f >> name >> sum) {
                for (int i = 0; i < kTexCount; ++i) {
                    if (name != TexFile(static_cast<Tex>(i))) continue;
                    unsigned long long mine = 0;
                    const Image& im = g_art.img[static_cast<size_t>(i)];
                    for (size_t k = 0; k < im.bgra.size(); k += 4) {
                        // same order as the reference: R, G, B, A
                        const uint8_t px[4] = {im.bgra[k + 2], im.bgra[k + 1], im.bgra[k], im.bgra[k + 3]};
                        for (uint8_t b : px) mine = (mine * 1099511628211ULL) ^ b;
                    }
                    if (mine != sum) return "pixels differ from PIL in " + name;
                }
            }
        }
        return "";
    });
    Check("WAV decoder reads every staged sound", [&]() -> std::string {
        const char* names[] = {"allin", "boss", "cancel", "card_deal", "card_flip", "check", "chip_bet", "chip_win", "cutin",
                               "defeat", "ending", "error", "fever", "fold", "lose_hand", "match", "meter_tick", "move", "ok",
                               "powerup", "roulette_tick", "star", "title", "type", "victory", "win_hand"};
        for (const char* n : names) {
            std::vector<uint8_t> b;
            Wav w;
            std::string err;
            if (!ReadFileBytes(g_root + "/Content/Raw/Audio/" + n + ".wav", b) || !DecodeWav(b.data(), b.size(), w, err)) {
                return std::string(n) + ": " + err;
            }
            if (w.sample_rate != 22050 || w.pcm.size() % static_cast<size_t>(2 * w.channels) != 0) return std::string(n) + ": format";
        }
        std::vector<uint8_t> b;
        ReadFileBytes(g_root + "/Content/Raw/Audio/ok.wav", b);
        Wav w;
        std::string err;
        DecodeWav(b.data(), b.size(), w, err);
        if (w.channels != 1 || w.pcm.size() != 4410 * 2) return "ok.wav frames";
        ReadFileBytes(g_root + "/Content/Raw/Audio/title.wav", b);
        DecodeWav(b.data(), b.size(), w, err);
        if (w.channels != 2 || w.pcm.size() != 987840ull * 4) return "title.wav frames";
        const uint8_t junk[12] = {'R', 'I', 'F', 'F', 0, 0, 0, 0, 'W', 'A', 'V', 'E'};
        if (DecodeWav(junk, sizeof(junk), w, err)) return "accepted an empty WAV";
        return "";
    });

    if (argc > 3 && std::string(argv[2]) == "--write-checks") {
        std::ofstream f(argv[3], std::ios::binary);
        f << "# Generated by tests/app/test_app.cpp (tests/run_all.sh). name<TAB>regex over DUMP lines joined by ;<TAB>-HBScript\n";
        for (const HarnessCheck& c : g_checks) f << c.name << '\t' << c.want << '\t' << c.script << '\n';
    }
    std::printf("APP TESTS %d/%d passed\n", g_pass, g_total);
    for (const std::string& f : g_failed) std::printf("  failed: %s\n", f.c_str());
    return g_pass == g_total ? 0 : 1;
}
