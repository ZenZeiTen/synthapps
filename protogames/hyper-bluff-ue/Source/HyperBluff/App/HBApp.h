// Hyper Bluff!! app layer: screens, menus, input, pacing, animation state, saves, the
// harness and the draw list. Port of hyper-bluff/godot/scripts/main.gd (logic) and
// view/render.gd (HBAppRender.cpp), plus the Director's Cut additions (HBJam.h).
// Plain C++20, no engine headers: the Unreal classes in Game/ only forward input, draw the
// list this produces and play the sounds it asks for. tests/app/ drives the same object on
// Linux through the same entry points.
#pragma once

#include <array>
#include <cstdint>
#include <deque>
#include <map>
#include <string>
#include <vector>

#include "HBAppTypes.h"
#include "HBGame.h"

namespace hb {
namespace app {

// Actions (main.gd ACTIONS), in the order main.gd checks them.
enum class Act : int { Up, Down, Left, Right, Ok, Cancel, Pause, Power1, Power2, Power3, Fold, Call, Raise, None };
const char* ActName(Act a);
Act ActFromName(const std::string& name);
// Keyboard and pad keys by Unreal FKey name ("Z", "SpaceBar", "Gamepad_FaceButton_Bottom").
Act ActForKey(const std::string& ue_key_name);
// Every key name the controller has to poll.
const std::vector<std::string>& AllKeyNames();
// Harness spellings ("1", "Space", "Esc", "Backspace") to Unreal key names; unknown names pass through.
std::string KeyAlias(const std::string& name);
// Godot JOY_BUTTON index (the harness's pad:n) or an Unreal pad key name to an Unreal key name.
std::string PadKeyName(const std::string& index_or_name);

// Story text box: 80 characters a line, at most 5 lines a page. Longer pages are split.
constexpr size_t kStoryChars = 80;
constexpr size_t kStoryLines = 5;
std::vector<std::string> WrapText(const std::string& t, size_t chars);
std::vector<std::string> PaginateStory(const std::vector<std::string>& pages);

enum class Screen : int { Title, Avatar, Story, Versus, Play, Pause, Options, MatchEnd, Scores, Credits };
const char* ScreenName(Screen s);

struct ScoreEntry {
    int64_t score = 0;
    std::string avatar;
    int floor_no = 1;
    bool clear = false;
};

struct Region {
    std::string id;
    RectF rect;
};

struct Flier {
    Vec2 from, to;
    int t = 0, dur = 20, delay = 0, frame = 0;
};

struct Pop {
    std::string text;
    float x = 0, y = 0;
    int t = 110;
    Color col;
};

struct CutIn {
    bool on = false;
    int who = 0;
    std::string text;
    int t = 0;
    int len = 100;
    bool clap = false;  // Director's Cut: CUT! RETAKE clapperboard
};

// A board card replaced by CUT! RETAKE: it stays in place until `start`, then flies off.
struct FlyOff {
    int card = 0;
    int idx = 0;
    int start = 0;
};

class App {
public:
    // Timing constants (main.gd).
    static constexpr int kScreenLock = 12;
    static constexpr int kDealTicks = 18;
    static constexpr int kFlipTicks = 14;
    static constexpr int kMeterSamples = 480;
    static constexpr int kRepeatDelay = 24;   // key repeat starts after 0.4 s
    static constexpr int kRepeatEvery = 5;    // then every 0.083 s
    static constexpr int kFlyOffTicks = 16;

    // has_script: run the harness (saves go to harness/, which is wiped first).
    void Init(Host* host, bool has_script, const std::string& script);
    // Art metadata: Content/Raw/Art/portraits.json and sheets.json (missing -> defaults).
    void SetArtMeta(const std::string& portraits_json, const std::string& sheets_json);
    void SetTextureSize(Tex t, int w, int h);

    // Advance by real time at a fixed 60 Hz (harness: 8 ticks per call, time ignored).
    void Frame(double dt_seconds);
    void Step();  // one tick, with the harness script first (main.gd _process body)

    // Input. Everything ends in Press(), as main.gd's _input does.
    void KeyDown(const std::string& ue_key);
    void KeyUp(const std::string& ue_key);
    void MouseMove(Vec2 p);
    void MouseClick(Vec2 p);
    void MouseWheel(int dir);  // +1 up, -1 down
    void Press(Act a);

    // Draw list for the current state (also refreshes the `fit` bookkeeping).
    const std::vector<DrawCmd>& Render();
    const std::vector<std::string>& FitFail() const { return fit_fail_; }

    std::string Dump() const;
    bool Harness() const { return harness_; }
    bool QuitRequested() const { return quit_; }
    bool ScriptDone() const { return script_.empty() && script_wait_ == 0 && busy_ == 0; }

    // Test hooks (tests/app only): show a speech bubble / message / hovered region as if the
    // game had set them, to measure text boxes with real data.
    void TestShow(const std::string& bubble, const std::string& msg, const std::string& hover) {
        bubble_ = bubble;
        bubble_t_ = bubble.empty() ? 0 : 100;
        bubble_age_ = 50;
        msg_ = msg;
        hover_ = hover;
    }

    // State the tests read.
    Screen screen() const { return screen_; }
    int cursor() const { return cursor_; }
    int lock() const { return lock_; }
    int tick() const { return tick_; }
    int wait() const { return wait_; }
    bool has_run() const { return has_run_; }
    const State& run() const { return s_; }
    State& run_mut() { return s_; }
    const std::string& music() const { return music_; }
    const std::string& last_sfx() const { return last_sfx_; }
    const CutIn& cutin() const { return cutin_; }
    const std::vector<FlyOff>& flyoffs() const { return flyoffs_; }
    int Pace() const { return opt_pace_; }
    bool MyTurn() const;
    int Moving() const;
    int PageT() const { return page_t_; }

    // Helpers shared with the renderer.
    int Pw(int n) const;  // a pause of n ticks at NORMAL, scaled by PACE
    std::vector<std::string> MenuItems() const;
    RectF MenuRect(int i) const;
    std::string RoomName() const;
    double MeterValue() const;
    std::string MeterTier() const;
    std::vector<int> RaiseOpts() const;

private:
    // ---- files ----
    std::string SavePath(const std::string& name) const { return save_dir_ + name; }
    void LoadFiles();
    void SaveOptions();
    void SaveScores();
    void ApplyOpts();
    bool HasSave() const;
    void SaveRun();
    void DropSave();
    void RecordScore(bool cleared);

    // ---- screens ----
    void Goto(Screen name);
    void StartStory(const std::vector<std::string>& list, const std::string& who, const std::string& after);
    void NewGame(const std::string& avatar);
    void BeginVersus();
    void BeginPlay();
    void AfterStory();
    void LeaveMatchEnd();
    void FinishCredits();

    // ---- input ----
    std::string RegionAt(Vec2 p);
    void BuildRegions();
    void Click(const std::string& id);
    void PressMenu(Act a, const std::vector<std::string>& items);
    void PressPlay(Act a);
    void Commit();

    // ---- play ----
    void Fly(Vec2 from, Vec2 to, int frame, int delay = 0);
    void NextHand();
    void Say(const std::string& which);
    void PopText(const std::string& text, float x, float y, Color col);
    void SetExpr(const std::string& p, const std::string& r);
    void Drain();
    bool UsePowerAnimated(int who, int slot);
    void TickPlay();
    void TickMeter();
    void Tick();
    void Sfx(const std::string& name);
    void Music(const std::string& name);

    // ---- harness ----
    void RunScript();
    void Out(const std::string& line);

    // ---- render (HBAppRender.cpp) ----
    struct Xf {
        float ox = 0, oy = 0, sx = 1, sy = 1;
    };
    void Rect(RectF r, Color c);
    void Outline(RectF r, Color c, float width = 1.0f);
    void Sprite(Tex t, RectF dst, RectF src, Color c);
    void Txt(const std::string& t, float x, float y, Color col = Color{}, char f = 's', int box = 0, int align = 0);
    void Shadow(const std::string& t, float x, float y, Color col, char f = 's', int box = 0, int align = 0);
    // One line of data-driven text in a box: squeezed horizontally when it is wider (never spills).
    void TxtFit(const std::string& t, float x, float y, Color col, int box, int align = 0);
    // Wrapped text in a box: as many lines as the box height holds; longer text pages through
    // its chunks every `page_ticks`. Returns the number of lines drawn.
    int WrapBox(const std::string& t, RectF box, float line_h, Color col, int align = 0, int page_ticks = 150);
    void Panel(RectF r, Color fill, Color border);
    void Panel(RectF r);
    void Dealt(int key, int c, float x, float y, bool up);
    void Card(int c, float x, float y, bool up = true, Color tint = Color{});
    void Icon(const std::string& name, float x, float y, Color tint = Color{});
    void Portrait(const std::string& id, const std::string& expr, float x, float y, bool framed = true);
    void Strip(Tex t, int frame, int size, float x, float y);
    void Menu(const std::vector<std::string>& items);
    void SpeedLines(RectF r, Color col, int seed_value);
    Color Accent() const;
    void Room();
    void Backdrop();
    void Logo(float y);
    void DrawTitle();
    void DrawAvatar();
    void DrawStory();
    void DrawMatchEnd();
    void DrawScores();
    void DrawCredits();
    void DrawPlay();
    void DrawMeter(float x, float y);
    void DrawButtons();
    void DrawResult();
    void DrawCutIn();
    void DrawClapper(float x, float y, int age);
    Vec2 TexSize(Tex t) const;

    // ---- data ----
    Host* host_ = nullptr;
    Screen screen_ = Screen::Title;
    int tick_ = 0;
    int lock_ = 0;
    int cursor_ = 0;
    std::vector<Region> hot_;
    std::string hover_;
    bool has_run_ = false;
    State s_;
    int opt_music_ = 7;
    int opt_sfx_ = 8;
    bool opt_full_ = false;
    int opt_pace_ = 0;
    std::vector<ScoreEntry> scores_;
    std::string save_dir_;
    bool harness_ = false;
    int64_t seed_next_ = 0;
    bool quit_ = false;
    double acc_ = 0.0;

    std::vector<std::string> pages_;
    int page_ = 0;
    int page_t_ = 0;
    std::string page_after_;
    std::string speaker_;

    int wait_ = 0;
    int btn_ = 1;
    int raise_i_ = 0;
    std::string msg_;
    std::string bubble_;
    int bubble_t_ = 0;
    std::string rexpr_ = "neutral";
    std::string pexpr_ = "neutral";
    int expr_t_ = 0;
    CutIn cutin_;
    std::vector<Pop> pops_;
    bool reveal_ = false;
    int shake_ = 0;
    int burst_t_ = 0;
    // card_t: p0 p1 r0 r1 b0..b4 -> tick the card leaves the deck (has_ false: no entry).
    std::array<bool, 9> card_has_{};
    std::array<int, 9> card_t_{};
    std::vector<Flier> fliers_;
    std::vector<FlyOff> flyoffs_;
    std::vector<int> retake_before_;
    double pot_show_ = 0.0;
    std::array<double, 2> stack_show_{{800.0, 800.0}};
    int result_t_ = 0;
    int bubble_age_ = 0;
    int last_bets_ = 0;
    std::string meter_key_;
    int64_t meter_score_ = 0;
    int meter_n_ = 0;
    int64_t meter_box_ = 1;
    double meter_show_ = 0.0;
    std::string rig_;
    Screen pause_from_ = Screen::Title;
    int last_rank_ = -1;
    double credits_y_ = 0.0;
    std::string music_;
    std::string last_sfx_;

    // input repeat: held key -> ticks held; swallowed keys were held across a screen change
    struct Held {
        Act act = Act::None;
        int t = 0;
        bool swallowed = false;
    };
    std::map<std::string, Held> held_;

    // harness
    std::deque<std::string> script_;
    int script_wait_ = 0;
    int busy_ = 0;  // ticks until a pending `fit` is taken (Godot waits two frames)

    // render
    std::vector<DrawCmd> draw_;
    std::vector<std::string> fit_fail_;
    // Every unscaled text and menu button drawn this frame (screen space), for the overlap check.
    std::vector<std::pair<RectF, std::string>> texts_;
    std::vector<std::pair<RectF, std::string>> btn_rects_;
    void Veil(float alpha);
    void CheckOverlaps();
    Xf xf_;
    Vec2 shake_off_;
    std::array<Vec2, kTexCount> tex_size_{};
    std::map<std::string, int> eye_y_;
    std::vector<std::string> portrait_order_;
    std::string head_;  // last big header drawn (episode label, match-end banner); the dump writes _ for spaces  // portraits.json "order": row of each cast id
    std::vector<std::string> icon_names_;
};

// Card-animation keys (main.gd's "p0", "r1", "b3").
constexpr int kKeyP0 = 0;
constexpr int kKeyR0 = 2;
constexpr int kKeyB0 = 4;

}  // namespace app
}  // namespace hb
