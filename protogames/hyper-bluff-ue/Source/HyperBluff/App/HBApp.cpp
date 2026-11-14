// Port of hyper-bluff/godot/scripts/main.gd. Function and variable names follow the GDScript
// (goto -> Goto, _press_play -> PressPlay, card_t -> card_t_) so the two can be read side by side.
#include "HBApp.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <sstream>

#include "HBAi.h"
#include "HBCards.h"
#include "HBData.h"
#include "HBJam.h"

namespace hb {
namespace app {

// ---- small helpers (names prefixed: the module may be built as one unity file) -------------

namespace {

int AppPosMod(int a, int n) {
    const int r = a % n;
    return r < 0 ? r + n : r;
}

int AppClampI(int v, int lo, int hi) { return v < lo ? lo : (v > hi ? hi : v); }

double AppMoveToward(double from, double to, double delta) {
    if (std::fabs(to - from) <= delta) return to;
    return from + (to > from ? delta : -delta);
}

std::vector<std::string> AppSplit(const std::string& text, char sep, bool keep_empty) {
    std::vector<std::string> out;
    std::string cur;
    for (char c : text) {
        if (c == sep) {
            if (keep_empty || !cur.empty()) out.push_back(cur);
            cur.clear();
        } else {
            cur += c;
        }
    }
    if (keep_empty || !cur.empty()) out.push_back(cur);
    return out;
}

int64_t AppToInt(const std::string& t) {
    int64_t v = 0;
    bool neg = false;
    size_t i = 0;
    if (i < t.size() && (t[i] == '-' || t[i] == '+')) {
        neg = t[i] == '-';
        ++i;
    }
    for (; i < t.size() && t[i] >= '0' && t[i] <= '9'; ++i) v = v * 10 + (t[i] - '0');
    return neg ? -v : v;
}

const char* const kPaceName[3] = {"RELAXED", "NORMAL", "FAST"};
const double kPace[3] = {1.5, 1.0, 0.6};
const Vec2 kSeat[2] = {{70, 300}, {440, 30}};
const Vec2 kBetSpot[2] = {{186, 186}, {186, 106}};
const Vec2 kPotSpot = {450, 142};
const double kTierAt[5] = {0.0, 0.4, 0.55, 0.7, 0.85};
const char* const kTierName[5] = {"SHAKY", "EVEN", "SOLID", "STRONG", "MONSTER"};

const char* RivalId(const State& s) { return jam::RivalId(s.rival); }
const CastEntry& RivalCast(const State& s) { return data::Rival(s.rival); }

bool IsDir(Act a) { return a == Act::Up || a == Act::Down || a == Act::Left || a == Act::Right; }

}  // namespace

// ---- action and key tables -------------------------------------------------------------------

const char* ActName(Act a) {
    static const char* const n[] = {"up", "down", "left", "right", "ok", "cancel", "pause",
                                    "power1", "power2", "power3", "fold", "call", "raise", ""};
    return n[static_cast<int>(a)];
}

Act ActFromName(const std::string& name) {
    for (int i = 0; i < static_cast<int>(Act::None); ++i) {
        if (name == ActName(static_cast<Act>(i))) return static_cast<Act>(i);
    }
    return Act::None;
}

namespace {
struct KeyRow {
    const char* key;
    Act act;
};
// main.gd ACTIONS and PADS, as Unreal FKey names.
const KeyRow kKeys[] = {
    {"Up", Act::Up}, {"W", Act::Up}, {"Gamepad_DPad_Up", Act::Up},
    {"Down", Act::Down}, {"S", Act::Down}, {"Gamepad_DPad_Down", Act::Down},
    {"Left", Act::Left}, {"A", Act::Left}, {"Gamepad_DPad_Left", Act::Left},
    {"Right", Act::Right}, {"D", Act::Right}, {"Gamepad_DPad_Right", Act::Right},
    {"Z", Act::Ok}, {"Enter", Act::Ok}, {"SpaceBar", Act::Ok}, {"Gamepad_FaceButton_Bottom", Act::Ok},
    {"X", Act::Cancel}, {"BackSpace", Act::Cancel}, {"Gamepad_FaceButton_Right", Act::Cancel},
    {"Escape", Act::Pause}, {"P", Act::Pause}, {"Gamepad_Special_Right", Act::Pause},
    {"One", Act::Power1}, {"Gamepad_FaceButton_Left", Act::Power1},
    {"Two", Act::Power2}, {"Gamepad_FaceButton_Top", Act::Power2},
    {"Three", Act::Power3}, {"Gamepad_RightShoulder", Act::Power3},
    {"F", Act::Fold}, {"Gamepad_LeftShoulder", Act::Fold},
    {"C", Act::Call},
    {"R", Act::Raise},
};
}  // namespace

Act ActForKey(const std::string& ue_key_name) {
    for (const KeyRow& r : kKeys) {
        if (ue_key_name == r.key) return r.act;
    }
    return Act::None;
}

const std::vector<std::string>& AllKeyNames() {
    static const std::vector<std::string> v = [] {
        std::vector<std::string> out;
        for (const KeyRow& r : kKeys) out.push_back(r.key);
        return out;
    }();
    return v;
}

std::string KeyAlias(const std::string& name) {
    static const char* const pairs[][2] = {
        {"1", "One"}, {"2", "Two"}, {"3", "Three"}, {"Space", "SpaceBar"}, {"Esc", "Escape"},
        {"Backspace", "BackSpace"}, {"Return", "Enter"}, {"UP", "Up"}, {"DOWN", "Down"},
        {"LEFT", "Left"}, {"RIGHT", "Right"}, {"ENTER", "Enter"}, {"ESCAPE", "Escape"},
        {"z", "Z"}, {"x", "X"}, {"c", "C"}, {"f", "F"}, {"r", "R"}, {"p", "P"},
    };
    for (const auto& p : pairs) {
        if (name == p[0]) return p[1];
    }
    return name;
}

std::string PadKeyName(const std::string& index_or_name) {
    // Godot JoyButton indexes used by main.gd PADS.
    static const char* const by_index[] = {
        "Gamepad_FaceButton_Bottom",  // 0 A
        "Gamepad_FaceButton_Right",   // 1 B
        "Gamepad_FaceButton_Left",    // 2 X
        "Gamepad_FaceButton_Top",     // 3 Y
        "Gamepad_Special_Left",       // 4 BACK
        "",                           // 5 GUIDE
        "Gamepad_Special_Right",      // 6 START
        "Gamepad_LeftThumbstick",     // 7
        "Gamepad_RightThumbstick",    // 8
        "Gamepad_LeftShoulder",       // 9
        "Gamepad_RightShoulder",      // 10
        "Gamepad_DPad_Up",            // 11
        "Gamepad_DPad_Down",          // 12
        "Gamepad_DPad_Left",          // 13
        "Gamepad_DPad_Right",         // 14
    };
    if (!index_or_name.empty() && index_or_name[0] >= '0' && index_or_name[0] <= '9') {
        const int64_t i = AppToInt(index_or_name);
        if (i >= 0 && i < 15) return by_index[i];
        return "";
    }
    return index_or_name;
}

const char* ScreenName(Screen s) {
    static const char* const n[] = {"title", "avatar", "story", "versus", "play",
                                    "pause", "options", "matchend", "scores", "credits"};
    return n[static_cast<int>(s)];
}

// ---- init and files --------------------------------------------------------------------------

void App::Init(Host* host, bool has_script, const std::string& script) {
    host_ = host;
    harness_ = has_script;
    if (harness_) {
        for (const std::string& c : AppSplit(script, ',', false)) script_.push_back(c);
        save_dir_ = "harness/";
        for (const char* f : {"run.sav", "options.sav", "scores.sav"}) host_->RemoveFile(SavePath(f));
        seed_next_ = 1234;
    }
    portrait_order_ = {"rin", "mako", "jiro", "aya", "pochi", "goro", "yuki", "zeno", "onyx"};
    icon_names_ = {"hawk", "swap", "guard", "over", "sight", "glare", "empty", "star", "dealer", "retake"};
    for (int i = 0; i < kTexCount; ++i) tex_size_[static_cast<size_t>(i)] = Vec2{0, 0};
    LoadFiles();
    ApplyOpts();
    Goto(Screen::Title);
}

void App::SetTextureSize(Tex t, int w, int h) {
    tex_size_[static_cast<size_t>(t)] = Vec2{static_cast<float>(w), static_cast<float>(h)};
}

void App::SetArtMeta(const std::string& portraits_json, const std::string& sheets_json) {
    // portraits.json: "eye_y": {"rin": 39, ...}. A tiny scanner, not a JSON parser.
    const size_t at = portraits_json.find("\"eye_y\"");
    if (at != std::string::npos) {
        const size_t open = portraits_json.find('{', at);
        const size_t close = portraits_json.find('}', open);
        if (open != std::string::npos && close != std::string::npos) {
            const std::string body = portraits_json.substr(open + 1, close - open - 1);
            for (const std::string& part : AppSplit(body, ',', false)) {
                const size_t q1 = part.find('"');
                const size_t q2 = part.find('"', q1 + 1);
                const size_t colon = part.find(':', q2);
                if (q1 == std::string::npos || q2 == std::string::npos || colon == std::string::npos) continue;
                std::string num;
                for (size_t i = colon + 1; i < part.size(); ++i) {
                    if (part[i] >= '0' && part[i] <= '9') num += part[i];
                }
                if (!num.empty()) eye_y_[part.substr(q1 + 1, q2 - q1 - 1)] = static_cast<int>(AppToInt(num));
            }
        }
    }
    // portraits.json: "order": [...] gives the row of each cast id in portraits.png.
    const size_t od = portraits_json.find("\"order\"");
    if (od != std::string::npos) {
        const size_t open = portraits_json.find('[', od);
        const size_t close = portraits_json.find(']', open);
        if (open != std::string::npos && close != std::string::npos) {
            std::vector<std::string> names;
            size_t i = open;
            while (true) {
                const size_t q1 = portraits_json.find('"', i + 1);
                if (q1 == std::string::npos || q1 > close) break;
                const size_t q2 = portraits_json.find('"', q1 + 1);
                if (q2 == std::string::npos || q2 > close) break;
                names.push_back(portraits_json.substr(q1 + 1, q2 - q1 - 1));
                i = q2;
            }
            if (!names.empty()) portrait_order_ = names;
        }
    }
    // sheets.json: "icons": ["hawk", ...] gives the order of icons.png.
    const size_t ic = sheets_json.find("\"icons\"");
    if (ic != std::string::npos) {
        const size_t open = sheets_json.find('[', ic);
        const size_t close = sheets_json.find(']', open);
        if (open != std::string::npos && close != std::string::npos) {
            std::vector<std::string> names;
            size_t i = open;
            while (true) {
                const size_t q1 = sheets_json.find('"', i + 1);
                if (q1 == std::string::npos || q1 > close) break;
                const size_t q2 = sheets_json.find('"', q1 + 1);
                if (q2 == std::string::npos || q2 > close) break;
                names.push_back(sheets_json.substr(q1 + 1, q2 - q1 - 1));
                i = q2;
            }
            if (!names.empty()) icon_names_ = names;
        }
    }
}

void App::LoadFiles() {
    std::string text;
    if (host_->ReadText(SavePath("options.sav"), text)) {
        for (const std::string& line : AppSplit(text, '\n', false)) {
            const size_t eq = line.find('=');
            if (eq == std::string::npos) continue;
            const std::string k = line.substr(0, eq);
            const int v = static_cast<int>(AppToInt(line.substr(eq + 1)));
            if (k == "music") opt_music_ = AppClampI(v, 0, 10);
            else if (k == "sfx") opt_sfx_ = AppClampI(v, 0, 10);
            else if (k == "full") opt_full_ = v != 0;
            else if (k == "pace") opt_pace_ = AppClampI(v, 0, 2);
        }
    }
    scores_.clear();
    if (host_->ReadText(SavePath("scores.sav"), text)) {
        for (const std::string& line : AppSplit(text, '\n', false)) {
            const std::vector<std::string> f = AppSplit(line, ' ', false);
            if (f.size() != 4 || data::FindCast(f[1]) == nullptr) continue;
            ScoreEntry e;
            e.score = AppToInt(f[0]);
            e.avatar = f[1];
            e.floor_no = static_cast<int>(AppToInt(f[2]));
            e.clear = f[3] == "1";
            scores_.push_back(e);
            if (scores_.size() >= 5) break;
        }
    }
}

void App::SaveOptions() {
    std::ostringstream o;
    o << "music=" << opt_music_ << "\nsfx=" << opt_sfx_ << "\nfull=" << (opt_full_ ? 1 : 0)
      << "\npace=" << opt_pace_ << "\n";
    host_->WriteText(SavePath("options.sav"), o.str());
}

void App::SaveScores() {
    std::ostringstream o;
    for (const ScoreEntry& e : scores_) {
        o << e.score << ' ' << e.avatar << ' ' << e.floor_no << ' ' << (e.clear ? 1 : 0) << "\n";
    }
    host_->WriteText(SavePath("scores.sav"), o.str());
}

void App::ApplyOpts() {
    host_->ApplyVolume(opt_music_, opt_sfx_);
    if (!harness_) host_->SetFullscreen(opt_full_);
}

bool App::HasSave() const { return host_->HasFile(SavePath("run.sav")); }

void App::SaveRun() { host_->WriteText(SavePath("run.sav"), game::Serialize(s_)); }

void App::DropSave() {
    if (HasSave()) host_->RemoveFile(SavePath("run.sav"));
}

void App::RecordScore(bool cleared) {
    ScoreEntry entry;
    entry.score = s_.score;
    entry.avatar = s_.avatar;
    entry.floor_no = std::min(s_.match + 1, jam::LadderSize());
    entry.clear = cleared;
    // Insert after every entry with a higher or equal score (a stable sort, as main.gd's
    // sort leaves the newest entry below equal ones).
    size_t at = 0;
    while (at < scores_.size() && scores_[at].score >= entry.score) ++at;
    scores_.insert(scores_.begin() + static_cast<std::ptrdiff_t>(at), entry);
    last_rank_ = static_cast<int>(at);
    if (scores_.size() > 5) scores_.resize(5);
    if (last_rank_ >= 5) last_rank_ = -1;
    SaveScores();
}

// ---- screens ---------------------------------------------------------------------------------

void App::Sfx(const std::string& name) {
    if (name != "meter_tick" && name != "type") last_sfx_ = name;
    host_->PlaySfx(name);
}

void App::Music(const std::string& name) {
    if (name == music_) return;
    music_ = name;
    host_->PlayMusic(name);
}

void App::Goto(Screen name) {
    screen_ = name;
    cursor_ = 0;
    lock_ = kScreenLock;
    hover_.clear();
    // A key held through a screen change does not repeat on the next screen.
    for (auto& kv : held_) kv.second.swallowed = true;
    switch (name) {
        case Screen::Title: Music("title"); break;
        case Screen::Avatar: Music("title"); break;
        case Screen::Scores: Music("ending"); break;
        case Screen::Credits:
            credits_y_ = 0.0;
            Music("ending");
            break;
        default: break;
    }
}

std::vector<std::string> App::MenuItems() const {
    switch (screen_) {
        case Screen::Title: {
            std::vector<std::string> items = {"NEW GAME"};
            if (HasSave()) items.push_back("CONTINUE");
            items.insert(items.end(), {"HIGH SCORES", "OPTIONS", "QUIT"});
            return items;
        }
        case Screen::Pause: return {"RESUME", "OPTIONS", "QUIT TO TITLE"};
        case Screen::Options:
            return {"MUSIC  " + std::to_string(opt_music_), "SOUND  " + std::to_string(opt_sfx_),
                    std::string("PACE  ") + kPaceName[opt_pace_],
                    std::string("FULL SCREEN  ") + (opt_full_ ? "ON" : "OFF"), "BACK"};
        case Screen::MatchEnd:
            if (has_run_ && s_.winner == 1) return {"CONTINUE (HALF SCORE)", "GIVE UP"};
            return {};
        default: return {};
    }
}

RectF App::MenuRect(int i) const {
    const float fi = static_cast<float>(i);
    switch (screen_) {
        case Screen::Title: return RectF{240, 222 + fi * 22, 160, 18};
        case Screen::MatchEnd: return RectF{200, 250 + fi * 24, 240, 20};
        default: return RectF{220, 130 + fi * 26, 200, 20};
    }
}

void App::StartStory(const std::vector<std::string>& list, const std::string& who, const std::string& after) {
    // A page longer than the text box holds is split into several pages (no spilling).
    pages_ = PaginateStory(list);
    page_ = 0;
    page_t_ = 0;
    speaker_ = who;
    page_after_ = after;
    Goto(Screen::Story);
}

void App::NewGame(const std::string& avatar) {
    const int64_t seed_value = seed_next_ != 0 ? seed_next_ : host_->NowSeed();
    s_ = game::NewRun(seed_value, avatar, /*director_cut=*/true);
    has_run_ = true;
    SaveRun();
    StartStory(data::StoryOpen(), "", "versus");
}

void App::BeginVersus() {
    Music(jam::IsFinalBoss(s_.rival) ? "boss" : "match");
    StartStory(jam::VersusPages(s_.rival), RivalId(s_), "play");
    screen_ = Screen::Versus;
}

int App::Pw(int n) const { return static_cast<int>(n * kPace[opt_pace_]); }

void App::Fly(Vec2 from, Vec2 to, int frame, int delay) {
    Flier f;
    f.from = from;
    f.to = to;
    f.frame = frame;
    f.delay = delay;
    fliers_.push_back(f);
}

void App::BeginPlay() {
    Goto(Screen::Play);
    wait_ = Pw(40);
    card_has_.fill(false);
    fliers_.clear();
    flyoffs_.clear();
    pot_show_ = 0.0;
    stack_show_ = {{static_cast<double>(s_.stack[0]), static_cast<double>(s_.stack[1])}};
    last_bets_ = 0;
    msg_.clear();
    bubble_.clear();
    reveal_ = false;
    rexpr_ = "neutral";
    pexpr_ = "neutral";
    cutin_ = CutIn();
    pops_.clear();
    btn_ = 1;
}

void App::AfterStory() {
    if (page_after_ == "versus" || page_after_ == "boss") BeginVersus();
    else if (page_after_ == "play") BeginPlay();
    else if (page_after_ == "credits") Goto(Screen::Credits);
    else if (page_after_ == "next") LeaveMatchEnd();
}

void App::LeaveMatchEnd() {
    game::NextMatch(s_);
    if (s_.phase == Phase::RunWon) {
        DropSave();
        Music("ending");
        StartStory(data::StoryEnd(), "", "credits");
        return;
    }
    SaveRun();
    const std::vector<std::string> before = jam::PagesBefore(s_.rival);
    if (!before.empty()) StartStory(before, "", "boss");
    else BeginVersus();
}

void App::FinishCredits() {
    RecordScore(true);
    Goto(Screen::Scores);
}

// ---- input -----------------------------------------------------------------------------------

void App::KeyDown(const std::string& ue_key) {
    const Act a = ActForKey(ue_key);
    if (a == Act::None) return;
    Held h;
    h.act = a;
    held_[ue_key] = h;
    Press(a);
}

void App::KeyUp(const std::string& ue_key) { held_.erase(ue_key); }

void App::MouseMove(Vec2 p) { hover_ = RegionAt(p); }

void App::MouseClick(Vec2 p) {
    const std::string id = RegionAt(p);
    if (lock_ == 0) Click(id);
}

void App::MouseWheel(int dir) { Press(dir > 0 ? Act::Up : Act::Down); }

std::string App::RegionAt(Vec2 p) {
    BuildRegions();
    for (int i = static_cast<int>(hot_.size()) - 1; i >= 0; --i) {
        if (hot_[static_cast<size_t>(i)].rect.Has(p)) return hot_[static_cast<size_t>(i)].id;
    }
    return "";
}

void App::BuildRegions() {
    hot_.clear();
    const std::vector<std::string> items = MenuItems();
    for (size_t i = 0; i < items.size(); ++i) {
        hot_.push_back({"menu:" + std::to_string(i), MenuRect(static_cast<int>(i))});
    }
    switch (screen_) {
        case Screen::Avatar:
            for (int i = 0; i < 4; ++i) {
                hot_.push_back({"avatar:" + std::to_string(i), RectF{58.0f + static_cast<float>(i) * 136, 96, 116, 116}});
            }
            break;
        case Screen::Story:
        case Screen::Versus:
        case Screen::Scores:
        case Screen::Credits: hot_.push_back({"next", RectF{0, 0, 640, 360}}); break;
        case Screen::MatchEnd:
            if (has_run_ && s_.winner == 0) hot_.push_back({"next", RectF{0, 0, 640, 360}});
            break;
        case Screen::Play:
            hot_.push_back({"next", RectF{0, 0, 640, 360}});
            hot_.push_back({"btn:0", RectF{112, 322, 100, 30}});
            hot_.push_back({"btn:1", RectF{218, 322, 130, 30}});
            hot_.push_back({"btn:2", RectF{354, 322, 150, 30}});
            hot_.push_back({"less", RectF{510, 322, 24, 30}});
            hot_.push_back({"more", RectF{538, 322, 24, 30}});
            for (int i = 0; i < 3; ++i) {
                hot_.push_back({"power:" + std::to_string(i), RectF{532.0f + static_cast<float>(i) * 35, 204, 32, 32}});
            }
            hot_.push_back({"pause", RectF{604, 4, 32, 14}});
            break;
        default: break;
    }
}

void App::Click(const std::string& id) {
    if (id.empty()) return;
    const std::vector<std::string> parts = AppSplit(id, ':', true);
    const std::string& kind = parts[0];
    const int arg = parts.size() > 1 ? static_cast<int>(AppToInt(parts[1])) : 0;
    if (kind == "menu") {
        cursor_ = arg;
        Press(Act::Ok);
    } else if (kind == "avatar") {
        if (cursor_ == arg) {
            Press(Act::Ok);
        } else {
            cursor_ = arg;
            Sfx("move");
        }
    } else if (kind == "btn") {
        if (MyTurn()) {
            btn_ = arg;
            Press(Act::Ok);
        }
    } else if (kind == "less") {
        Press(Act::Down);
    } else if (kind == "more") {
        Press(Act::Up);
    } else if (kind == "power") {
        Press(static_cast<Act>(static_cast<int>(Act::Power1) + arg));
    } else if (kind == "pause") {
        Press(Act::Pause);
    } else if (kind == "next") {
        Press(Act::Ok);
    }
}

bool App::MyTurn() const {
    return screen_ == Screen::Play && has_run_ && s_.phase == Phase::Bet && s_.to_act == 0 && wait_ == 0 &&
           !cutin_.on;
}

void App::Press(Act a) {
    if (lock_ > 0 || a == Act::None) return;
    const std::vector<std::string> items = MenuItems();
    if (!items.empty()) {
        PressMenu(a, items);
        return;
    }
    switch (screen_) {
        case Screen::Avatar:
            if (a == Act::Left || a == Act::Right) {
                cursor_ = AppPosMod(cursor_ + (a == Act::Right ? 1 : -1), 4);
                Sfx("move");
            } else if (a == Act::Ok) {
                Sfx("ok");
                NewGame(data::kAvatars[static_cast<size_t>(cursor_)]);
            } else if (a == Act::Cancel || a == Act::Pause) {
                Sfx("cancel");
                Goto(Screen::Title);
            }
            break;
        case Screen::Story:
        case Screen::Versus:
            if (a == Act::Ok || a == Act::Cancel) {
                if (page_t_ < 15) return;
                const int full = static_cast<int>(pages_[static_cast<size_t>(page_)].size());
                if (page_t_ < full) {
                    page_t_ = full;
                } else {
                    page_ += 1;
                    page_t_ = 0;
                    Sfx("ok");
                    if (page_ >= static_cast<int>(pages_.size())) AfterStory();
                }
            }
            break;
        case Screen::Scores:
            if (a == Act::Ok || a == Act::Cancel || a == Act::Pause) {
                Sfx("ok");
                Goto(Screen::Title);
            }
            break;
        case Screen::Credits:
            if (a == Act::Ok || a == Act::Cancel || a == Act::Pause) FinishCredits();
            break;
        case Screen::MatchEnd:
            if (a == Act::Ok && s_.winner == 0) {
                Sfx("ok");
                StartStory(RivalCast(s_).beaten, RivalId(s_), "next");
                screen_ = Screen::Versus;
            }
            break;
        case Screen::Play: PressPlay(a); break;
        default: break;
    }
}

void App::PressMenu(Act a, const std::vector<std::string>& items) {
    const int n = static_cast<int>(items.size());
    if (a == Act::Up || a == Act::Down) {
        cursor_ = AppPosMod(cursor_ + (a == Act::Down ? 1 : -1), n);
        Sfx("move");
        return;
    }
    if (screen_ == Screen::Options && (a == Act::Left || a == Act::Right)) {
        const int d = a == Act::Right ? 1 : -1;
        if (cursor_ == 0) opt_music_ = AppClampI(opt_music_ + d, 0, 10);
        else if (cursor_ == 1) opt_sfx_ = AppClampI(opt_sfx_ + d, 0, 10);
        else if (cursor_ == 2) opt_pace_ = AppPosMod(opt_pace_ + d, 3);
        else if (cursor_ == 3) opt_full_ = !opt_full_;
        ApplyOpts();
        SaveOptions();
        Sfx("move");
        return;
    }
    if (a == Act::Cancel || a == Act::Pause) {
        if (screen_ == Screen::Pause) {
            Sfx("cancel");
            screen_ = Screen::Play;
            lock_ = kScreenLock;
        } else if (screen_ == Screen::Options) {
            Sfx("cancel");
            Goto(pause_from_);
        }
        return;
    }
    if (a != Act::Ok) return;
    Sfx("ok");
    const std::string label = items[static_cast<size_t>(AppClampI(cursor_, 0, n - 1))];
    switch (screen_) {
        case Screen::Title:
            if (label == "NEW GAME") {
                Goto(Screen::Avatar);
            } else if (label == "CONTINUE") {
                std::string text;
                State loaded;
                if (host_->ReadText(SavePath("run.sav"), text) && game::Deserialize(text, loaded)) {
                    s_ = loaded;
                    s_.director_cut = true;
                    has_run_ = true;
                    game::StartMatch(s_);
                    BeginVersus();
                }
            } else if (label == "HIGH SCORES") {
                last_rank_ = -1;
                Goto(Screen::Scores);
            } else if (label == "OPTIONS") {
                pause_from_ = Screen::Title;
                Goto(Screen::Options);
            } else {
                if (harness_) Out("DUMP quit");
                quit_ = true;
                host_->Quit();
            }
            break;
        case Screen::Pause:
            if (cursor_ == 0) {
                screen_ = Screen::Play;
                lock_ = kScreenLock;
            } else if (cursor_ == 1) {
                pause_from_ = Screen::Pause;
                Goto(Screen::Options);
            } else {
                Goto(Screen::Title);
            }
            break;
        case Screen::Options:
            if (cursor_ == 2) {
                opt_pace_ = AppPosMod(opt_pace_ + 1, 3);
                SaveOptions();
            } else if (cursor_ == 3) {
                opt_full_ = !opt_full_;
                ApplyOpts();
                SaveOptions();
            } else if (cursor_ == 4) {
                Goto(pause_from_);
            }
            break;
        case Screen::MatchEnd:
            if (cursor_ == 0) {
                game::ContinueRun(s_);
                SaveRun();
                BeginVersus();
            } else {
                RecordScore(false);
                DropSave();
                Goto(Screen::Scores);
            }
            break;
        default: break;
    }
}

std::vector<int> App::RaiseOpts() const {
    if (has_run_ && s_.phase == Phase::Bet) return game::RaiseOptions(s_, 0);
    return {};
}

void App::PressPlay(Act a) {
    if (a == Act::Pause) {
        Sfx("ok");
        Goto(Screen::Pause);
        return;
    }
    if (cutin_.on) return;
    if (a == Act::Power1 || a == Act::Power2 || a == Act::Power3) {
        if (MyTurn()) {
            const int slot = static_cast<int>(a) - static_cast<int>(Act::Power1);
            if (UsePowerAnimated(0, slot)) {
                Drain();
            } else {
                Sfx("error");
                if (slot < static_cast<int>(s_.powers[0].size())) msg_ = "That power cannot be used right now.";
            }
        }
        return;
    }
    if (s_.phase == Phase::HandOver || s_.phase == Phase::MatchOver) {
        if (a == Act::Ok && wait_ == 0) {
            Sfx("ok");
            if (s_.phase == Phase::MatchOver) {
                Music(s_.winner == 0 ? "victory" : "defeat");
                Goto(Screen::MatchEnd);
            } else {
                NextHand();
            }
        }
        return;
    }
    if (!MyTurn()) {
        if (a == Act::Ok && wait_ > 12) wait_ = 12;
        return;
    }
    const std::vector<int> ro = RaiseOpts();
    switch (a) {
        case Act::Left:
            btn_ = AppPosMod(btn_ - 1, 3);
            Sfx("move");
            break;
        case Act::Right:
            btn_ = AppPosMod(btn_ + 1, 3);
            Sfx("move");
            break;
        case Act::Up:
        case Act::Down:
            if (!ro.empty()) {
                raise_i_ = AppClampI(raise_i_ + (a == Act::Up ? 1 : -1), 0, static_cast<int>(ro.size()) - 1);
                btn_ = 2;
                Sfx("roulette_tick");
            }
            break;
        case Act::Fold:
            btn_ = 0;
            Commit();
            break;
        case Act::Call:
            btn_ = 1;
            Commit();
            break;
        case Act::Raise:
            btn_ = 2;
            Commit();
            break;
        case Act::Ok: Commit(); break;
        case Act::Cancel:
            btn_ = 1;
            Sfx("move");
            break;
        default: break;
    }
}

void App::Commit() {
    const std::vector<int> ro = RaiseOpts();
    if (btn_ == 2) {
        if (ro.empty()) {
            Sfx("error");
            msg_ = "You cannot raise right now.";
            return;
        }
        game::Act(s_, 0, Action::Raise, ro[static_cast<size_t>(AppClampI(raise_i_, 0, static_cast<int>(ro.size()) - 1))]);
    } else if (btn_ == 0) {
        if (game::ToCall(s_, 0) == 0) {
            Sfx("error");
            msg_ = "Nothing to call. Check instead of folding.";
            return;
        }
        game::Act(s_, 0, Action::Fold);
    } else {
        game::Act(s_, 0, Action::Call);
    }
    raise_i_ = 0;
    btn_ = 1;
    Drain();
    wait_ = Pw(40);
}

// ---- play flow -------------------------------------------------------------------------------

void App::NextHand() {
    game::StartHand(s_);
    if (!rig_.empty()) {
        const bool win = rig_ == "win";
        s_.hole = {{cards::Parse(win ? "As Ad" : "7h 2c"), cards::Parse(win ? "7h 2c" : "As Ad")}};
        s_.runout = cards::Parse("Ks Qd 9c 4h 3s");
        rig_.clear();
    }
    reveal_ = false;
    result_t_ = 0;
    card_has_.fill(false);
    const int order[4] = {kKeyP0, kKeyR0, kKeyP0 + 1, kKeyR0 + 1};
    for (int i = 0; i < 4; ++i) {
        card_has_[static_cast<size_t>(order[i])] = true;
        card_t_[static_cast<size_t>(order[i])] = tick_ + 6 + i * 12;
    }
    flyoffs_.clear();
    msg_.clear();
    raise_i_ = 0;
    btn_ = 1;
    Drain();
    last_bets_ = 0;
    Fly(kSeat[0], kBetSpot[0], 2, 50);
    Fly(kSeat[1], kBetSpot[1], 1, 56);
    wait_ = Pw(60) + 50;
}

void App::Say(const std::string& which) {
    const CastEntry& c = RivalCast(s_);
    const std::vector<std::string>* lines = &c.win;
    if (which == "lose") lines = &c.lose;
    else if (which == "allin") lines = &c.allin;
    if (lines->empty()) return;
    bubble_ = (*lines)[static_cast<size_t>(tick_) % lines->size()];
    bubble_t_ = Pw(200);
    bubble_age_ = 0;
}

void App::PopText(const std::string& text, float x, float y, Color col) {
    Pop p;
    p.text = text;
    p.x = x;
    p.y = y;
    p.col = col;
    pops_.push_back(p);
}

void App::SetExpr(const std::string& p, const std::string& r) {
    pexpr_ = p;
    rexpr_ = r;
    expr_t_ = Pw(180);
}

bool App::UsePowerAnimated(int who, int slot) {
    retake_before_ = s_.board;
    return game::UsePower(s_, who, slot);
}

void App::Drain() {
    const std::string rname = RivalCast(s_).name;
    for (const Event& e : s_.events) {
        switch (e.t) {
            case EventType::Hand: break;
            case EventType::Fever:
                Sfx("fever");
                Music("fever");
                PopText("FEVER TIME!! x3", 250, 100, Rgba(1, 0.4f, 0.8f));
                shake_ = 20;
                break;
            case EventType::Act: {
                const int who = e.who;
                const std::string name = who == 0 ? "You" : rname;
                switch (e.a) {
                    case Shown::Fold:
                        Sfx("fold");
                        msg_ = name + (who == 0 ? " fold." : " folds.");
                        break;
                    case Shown::Check:
                        Sfx("check");
                        msg_ = name + (who == 0 ? " check." : " checks.");
                        break;
                    case Shown::Call:
                        Sfx("chip_bet");
                        Fly(kSeat[who], kBetSpot[who], 2 - who);
                        msg_ = name + (who == 0 ? " call." : " calls.");
                        break;
                    case Shown::Bet:
                    case Shown::Raise:
                        Sfx("chip_bet");
                        Fly(kSeat[who], kBetSpot[who], 2 - who);
                        Fly(kSeat[who], kBetSpot[who], 3, 5);
                        msg_ = name + (who == 0 ? " raise" : " raises") + " to " + std::to_string(e.amt) + ".";
                        break;
                    case Shown::AllIn:
                        Sfx("allin");
                        for (int k = 0; k < 5; ++k) Fly(kSeat[who], kBetSpot[who], k, k * 4);
                        msg_ = name + (who == 0 ? " are ALL IN!" : " is ALL IN!");
                        shake_ = 14;
                        cutin_ = CutIn();
                        cutin_.on = true;
                        cutin_.who = who;
                        cutin_.text = "ALL IN!!";
                        cutin_.t = 100;
                        cutin_.len = 100;
                        if (who == 1) Say("allin");
                        break;
                }
                break;
            }
            case EventType::Power: {
                Sfx("powerup");
                const int who = e.who;
                const PowerInfo& info = data::PowerInfoOf(e.power);
                cutin_ = CutIn();
                cutin_.on = true;
                cutin_.who = who;
                cutin_.text = std::string(info.name) + "!!";
                cutin_.t = 100;
                cutin_.len = 100;
                msg_ = (who == 0 ? std::string("You use ") : rname + " uses ") + info.name + ": " + info.desc;
                if (e.power == Power::Retake) {
                    // Director's Cut: the old shot stays until the cut-in closes, then flies
                    // off the table and the reshot cards deal in from the deck.
                    cutin_.clap = true;
                    const int n = game::StreetCards(s_.street);
                    const int first = static_cast<int>(s_.board.size()) - n;
                    for (int i = first; i < static_cast<int>(s_.board.size()); ++i) {
                        if (i < static_cast<int>(retake_before_.size())) {
                            FlyOff f;
                            f.card = retake_before_[static_cast<size_t>(i)];
                            f.idx = i;
                            f.start = tick_ + cutin_.len + (i - first) * 4;
                            flyoffs_.push_back(f);
                        }
                        card_has_[static_cast<size_t>(kKeyB0 + i)] = true;
                        card_t_[static_cast<size_t>(kKeyB0 + i)] = tick_ + cutin_.len + 12 + (i - first) * 16;
                    }
                }
                break;
            }
            case EventType::Street: {
                const int first = e.n == 1 ? 0 : e.n + 1;
                for (int i = first; i < static_cast<int>(s_.board.size()); ++i) {
                    card_has_[static_cast<size_t>(kKeyB0 + i)] = true;
                    card_t_[static_cast<size_t>(kKeyB0 + i)] = tick_ + 8 + (i - first) * 16;
                }
                break;
            }
            case EventType::Star:
                Sfx("star");
                PopText("STAR +" + std::to_string(e.value), 208.0f + static_cast<float>(e.idx) * 46, 116,
                        Rgba(1, 0.9f, 0.3f));
                if (e.power != Power::None) PopText("777! NEW POWER", 250, 96, Rgba(0.5f, 1, 1));
                break;
            case EventType::Settle: {
                reveal_ = s_.result.showdown;
                const int w = e.winner;
                result_t_ = 0;
                if (w >= 0) {
                    for (int k = 0; k < 6; ++k) Fly(kPotSpot, kSeat[w], k % 5, 20 + k * 5);
                }
                if (w == 0) {
                    Sfx("chip_win");
                    burst_t_ = 36;
                    SetExpr("happy", "shock");
                    Say("lose");
                    if (s_.result.points > 0) {
                        PopText("+" + std::to_string(s_.result.points) + " PTS", 260, 180, Rgba(1, 1, 0.5f));
                    }
                } else if (w == 1) {
                    Sfx("lose_hand");
                    SetExpr("shock", "happy");
                    Say("win");
                } else {
                    Sfx("check");
                }
                if (s_.phase == Phase::MatchOver) {
                    SetExpr(s_.winner == 0 ? "happy" : "defeat", s_.winner == 0 ? "defeat" : "happy");
                    expr_t_ = 100000;
                }
                if (s_.fever) Music(jam::IsFinalBoss(s_.rival) ? "boss" : "match");
                break;
            }
        }
    }
    s_.events.clear();
}

int App::Moving() const {
    int moving = 0;
    for (size_t k = 0; k < card_has_.size(); ++k) {
        if (card_has_[k] && tick_ - card_t_[k] < kDealTicks + kFlipTicks) ++moving;
    }
    return moving;
}

void App::TickPlay() {
    for (size_t k = 0; k < card_has_.size(); ++k) {
        if (!card_has_[k]) continue;
        const bool face_up_key = k < 2 || k >= static_cast<size_t>(kKeyB0);  // "p" and "b" keys flip
        if (card_t_[k] == tick_) Sfx("card_deal");
        else if (card_t_[k] + kDealTicks == tick_ && face_up_key) Sfx("card_flip");
    }
    for (Flier& f : fliers_) {
        if (f.delay > 0) f.delay -= 1;
        else f.t += 1;
    }
    fliers_.erase(std::remove_if(fliers_.begin(), fliers_.end(), [](const Flier& f) { return f.t >= f.dur; }),
                  fliers_.end());
    flyoffs_.erase(std::remove_if(flyoffs_.begin(), flyoffs_.end(),
                                  [this](const FlyOff& f) { return tick_ - f.start >= kFlyOffTicks; }),
                   flyoffs_.end());
    const int bets_now = s_.bet[0] + s_.bet[1];
    if (last_bets_ > 0 && bets_now == 0 && (s_.phase == Phase::Advance || s_.phase == Phase::Showdown)) {
        Fly(kBetSpot[0], kPotSpot, 2);
        Fly(kBetSpot[1], kPotSpot, 1);
        Sfx("chip_bet");
    }
    last_bets_ = bets_now;
    double pot_target = static_cast<double>(game::Pot(s_));
    if (s_.phase == Phase::HandOver || s_.phase == Phase::MatchOver) {
        pot_target = 0.0;
        if (wait_ == 0) result_t_ += 1;
    }
    pot_show_ = AppMoveToward(pot_show_, pot_target, std::max(1.0, std::fabs(pot_target - pot_show_) * 0.12));
    for (int i = 0; i < 2; ++i) {
        const double target = static_cast<double>(s_.stack[static_cast<size_t>(i)]);
        double& v = stack_show_[static_cast<size_t>(i)];
        v = AppMoveToward(v, target, std::max(1.0, std::fabs(target - v) * 0.12));
    }
    bubble_age_ += 1;
    if (bubble_t_ > 0) bubble_t_ -= 1;
    if (expr_t_ > 0) {
        expr_t_ -= 1;
        if (expr_t_ == 0) {
            pexpr_ = "neutral";
            rexpr_ = "neutral";
        }
    }
    if (shake_ > 0) shake_ -= 1;
    if (burst_t_ > 0) burst_t_ -= 1;
    for (Pop& p : pops_) {
        p.t -= 1;
        p.y -= 0.3f;
    }
    pops_.erase(std::remove_if(pops_.begin(), pops_.end(), [](const Pop& p) { return p.t <= 0; }), pops_.end());
    TickMeter();
    if (cutin_.on) {
        // A clapperboard cut-in snaps 12 ticks in; the others sound as they open.
        if (cutin_.t == cutin_.len - (cutin_.clap ? 12 : 0)) Sfx("cutin");
        cutin_.t -= 1;
        if (cutin_.t <= 0) cutin_ = CutIn();
        return;
    }
    if (wait_ > 0) {
        wait_ -= 1;
        return;
    }
    switch (s_.phase) {
        case Phase::Pre: NextHand(); break;
        case Phase::Bet:
            if (s_.to_act == 1) {
                const ai::Decision d = ai::Think(s_, 1);
                if (d.use_power) UsePowerAnimated(1, d.slot);
                else game::Act(s_, 1, d.a, d.amt);
                Drain();
                wait_ = Pw(70);
            } else if (msg_.empty()) {
                msg_ = "Your move.";
            }
            break;
        case Phase::Advance:
            game::Advance(s_);
            Drain();
            wait_ = Pw(60) + (s_.street == 1 ? 70 : 38);
            break;
        case Phase::Showdown:
            if (s_.folded < 0 && !reveal_) {
                reveal_ = true;
                card_has_[kKeyR0] = true;
                card_t_[kKeyR0] = tick_ - kDealTicks;
                card_has_[kKeyR0 + 1] = true;
                card_t_[kKeyR0 + 1] = tick_ - kDealTicks + 10;
                Sfx("card_flip");
                wait_ = Pw(80);
                return;
            }
            game::Settle(s_);
            Drain();
            wait_ = Pw(50);
            break;
        default: break;
    }
}

double App::MeterValue() const {
    return static_cast<double>(meter_score_) / static_cast<double>(std::max(1, 2 * meter_n_));
}

std::string App::MeterTier() const {
    const double v = MeterValue();
    std::string name = "SHAKY";
    for (int i = 0; i < 5; ++i) {
        if (v >= kTierAt[i]) name = kTierName[i];
    }
    return name;
}

void App::TickMeter() {
    if (!has_run_ || s_.hole[0].empty()) return;
    const std::vector<int> board = game::KnownBoard(s_, 0);
    std::vector<int> opp = game::KnownOpp(s_, 0);
    if (reveal_) opp = s_.hole[1];
    std::string key;
    for (int c : s_.hole[0]) key += std::to_string(c) + ",";
    key += "|";
    for (int c : board) key += std::to_string(c) + ",";
    key += "|";
    for (int c : opp) key += std::to_string(c) + ",";
    if (key != meter_key_) {
        meter_key_ = key;
        meter_score_ = 0;
        meter_n_ = 0;
        meter_box_ = 4242;
    }
    if (meter_n_ < kMeterSamples) {
        const cards::EquityScore r = cards::EquityBatch(s_.hole[0], board, opp, {}, 60, meter_box_);
        meter_score_ += r.score;
        meter_n_ += r.samples;
        if (tick_ % 4 == 0 && screen_ == Screen::Play) Sfx("meter_tick");
    }
    meter_show_ += (MeterValue() - meter_show_) * 0.07;
}

// ---- main loop -------------------------------------------------------------------------------

void App::Frame(double dt_seconds) {
    if (harness_) {
        for (int i = 0; i < 8 && !quit_; ++i) Step();
        return;
    }
    acc_ += dt_seconds;
    int steps = static_cast<int>(acc_ * 60.0);
    if (steps > 6) {  // a long hitch: do not fast-forward the table
        steps = 6;
        acc_ = 0.0;
    } else {
        acc_ -= steps / 60.0;
    }
    for (int i = 0; i < steps && !quit_; ++i) Step();
}

void App::Step() {
    if (harness_) RunScript();
    if (!quit_) Tick();
}

void App::Tick() {
    tick_ += 1;
    if (lock_ > 0) lock_ -= 1;
    // Key repeat for held directions (Godot's echo), never for a key held across screens.
    for (auto& kv : held_) {
        Held& h = kv.second;
        if (!IsDir(h.act) || h.swallowed) continue;
        h.t += 1;
        if (h.t >= kRepeatDelay && (h.t - kRepeatDelay) % kRepeatEvery == 0) Press(h.act);
    }
    switch (screen_) {
        case Screen::Story:
        case Screen::Versus:
            page_t_ += 1;
            if (page_ < static_cast<int>(pages_.size()) &&
                page_t_ <= static_cast<int>(pages_[static_cast<size_t>(page_)].size()) && page_t_ % 4 == 0) {
                Sfx("type");
            }
            break;
        case Screen::Play: TickPlay(); break;
        case Screen::Credits:
            credits_y_ += 0.4;
            if (credits_y_ > static_cast<double>(jam::Credits().size()) * 16 + 380) FinishCredits();
            break;
        default: break;
    }
}

// ---- harness ---------------------------------------------------------------------------------

std::string App::RoomName() const {
    return "bg_floor" + std::to_string((has_run_ ? jam::RoomIndex(s_.match) : 0) + 1);
}

std::string App::Dump() const {
    std::ostringstream o;
    o << "screen=" << ScreenName(screen_) << " cur=" << cursor_;
    if (screen_ == Screen::Story || screen_ == Screen::Versus) o << " page=" << page_ << "/" << pages_.size();
    if (has_run_) {
        o << " rival=" << RivalId(s_) << " phase=" << PhaseName(s_.phase) << " hand=" << s_.hand_no
          << " street=" << s_.street << " to_act=" << s_.to_act << " pot=" << game::Pot(s_) << " stack=" << s_.stack[0]
          << "/" << s_.stack[1] << " score=" << s_.score << " powers=" << s_.powers[0].size() << "/"
          << s_.powers[1].size() << " btn=" << btn_;
        o << " meter=" << static_cast<long long>(std::llround(MeterValue() * 100)) << " fever=" << (s_.fever ? 1 : 0)
          << " winner=" << s_.winner;
    }
    o << " moving=" << Moving() << " fliers=" << fliers_.size() << " pace=" << kPaceName[opt_pace_]
      << " room=" << RoomName() << " head=";
    for (char c : head_) o << (c == ' ' ? '_' : c);
    o << " music=" << music_ << " sfx=" << last_sfx_ << " save=" << (HasSave() ? 1 : 0) << " scores=" << scores_.size()
      << " opts=" << opt_music_ << "/" << opt_sfx_;
    // Director's Cut fields (after every field the Godot checks read).
    std::string board;
    if (has_run_) {
        for (size_t i = 0; i < s_.board.size(); ++i) board += (i ? "," : "") + cards::Label(s_.board[i]);
    }
    o << " board=" << (board.empty() ? "-" : board) << " cutin=" << (cutin_.on ? (cutin_.clap ? "clap" : "on") : "-")
      << " flyoff=" << flyoffs_.size() << " episode=" << (has_run_ ? s_.match + 1 : 0);
    return o.str();
}

void App::Out(const std::string& line) { host_->Print(line); }

void App::RunScript() {
    if (busy_ > 0) {
        busy_ -= 1;
        if (busy_ > 0) return;
        Render();
        std::string first;
        for (size_t i = 0; i < fit_fail_.size() && i < 5; ++i) first += (i ? ";" : "") + fit_fail_[i];
        Out("DUMP fit=" + std::to_string(fit_fail_.size()) + " " + first);
    }
    if (script_wait_ > 0) {
        script_wait_ -= 1;
        return;
    }
    while (!script_.empty() && script_wait_ == 0 && busy_ == 0 && !quit_) {
        const std::string cmd = script_.front();
        script_.pop_front();
        const std::vector<std::string> p = AppSplit(cmd, ':', true);
        const std::string& op = p[0];
        const std::string a1 = p.size() > 1 ? p[1] : "";
        if (op == "wait") {
            script_wait_ = static_cast<int>(AppToInt(a1));
        } else if (op == "tap") {
            Press(ActFromName(a1));
            script_wait_ = 1;
        } else if (op == "key") {
            const std::string k = KeyAlias(a1);
            KeyDown(k);
            KeyUp(k);
            script_wait_ = 1;
        } else if (op == "pad") {
            const std::string k = PadKeyName(a1);
            KeyDown(k);
            KeyUp(k);
            script_wait_ = 1;
        } else if (op == "click") {
            BuildRegions();
            const std::string id = cmd.substr(6);
            bool found = false;
            for (const Region& h : hot_) {
                if (h.id == id) {
                    found = true;
                    MouseClick(h.rect.Center());
                    break;
                }
            }
            if (!found) Out("HARNESS no region " + id);
            script_wait_ = 1;
        } else if (op == "wheel") {
            MouseWheel(a1 == "up" ? 1 : -1);
            script_wait_ = 1;
        } else if (op == "seed") {
            seed_next_ = AppToInt(a1);
        } else if (op == "rig") {
            rig_ = a1;
            if (has_run_) {
                // All chips but 5 to the rigged winner (works for any starting stack).
                const int total = s_.stack[0] + s_.stack[1] + game::Pot(s_);
                s_.stack = a1 == "win" ? std::array<int, 2>{{total - 5, 5}} : std::array<int, 2>{{5, total - 5}};
            }
        } else if (op == "floor") {
            if (has_run_) {
                s_.match = static_cast<int>(AppToInt(a1));
                game::StartMatch(s_);
            }
        } else if (op == "give") {
            if (has_run_) {
                s_.powers[0].clear();
                for (const std::string& n : AppSplit(a1, '+', false)) {
                    const Power pw = PowerFromName(n);
                    if (pw != Power::None) s_.powers[0].push_back(pw);
                }
            }
        } else if (op == "fever") {
            if (has_run_) s_.fever = true;
        } else if (op == "score") {
            if (has_run_) s_.score = AppToInt(a1);
        } else if (op == "until") {
            // until:<mine|over|screen>:max-ticks waits while the game keeps running
            bool met = false;
            if (a1 == "mine") {
                met = MyTurn();
            } else if (a1 == "over") {
                met = screen_ == Screen::Play && has_run_ &&
                      (s_.phase == Phase::HandOver || s_.phase == Phase::MatchOver) && wait_ == 0;
            } else {
                met = a1 == ScreenName(screen_) && lock_ == 0;
            }
            if (!met) {
                const int64_t left = AppToInt(p.size() > 2 ? p[2] : "0") - 1;
                if (left > 0) {
                    script_.push_front("until:" + a1 + ":" + std::to_string(left));
                    script_wait_ = 1;
                } else {
                    Out("HARNESS until timed out " + a1);
                }
            }
        } else if (op == "dump") {
            Render();  // the header of the frame on screen (Godot draws every frame)
            Out("DUMP " + Dump());
        } else if (op == "fit") {
            busy_ = 16;  // Godot redraws and waits two frames of 8 ticks first
        } else if (op == "shot") {
            Out("note: shot is not supported in this build");
        } else if (op == "quit") {
            quit_ = true;
            host_->Quit();
        } else {
            Out("HARNESS unknown command " + cmd);
        }
    }
    if (script_.empty() && script_wait_ == 0 && busy_ == 0 && !quit_) {
        quit_ = true;
        host_->Quit();
    }
}

}  // namespace app
}  // namespace hb
