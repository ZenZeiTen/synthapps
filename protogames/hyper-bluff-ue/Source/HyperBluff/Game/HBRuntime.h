// The plain C++ side of the game, owned by AHBGameMode: the app (Source/HyperBluff/App), the
// Unreal implementation of its Host, and the decoded sounds. Not a UHT header.
#pragma once

#include "CoreMinimal.h"

#include <map>
#include <string>

#include "HBApp.h"
#include "HBMedia.h"

class AHBGameMode;

/** hb::app::Host on top of Unreal: save files under Saved/HyperBluff/, sounds via the game mode. */
class FHBHost : public hb::app::Host
{
public:
	explicit FHBHost(AHBGameMode* InOwner) : Owner(InOwner) {}

	virtual bool ReadText(const std::string& Name, std::string& Out) override;
	virtual bool WriteText(const std::string& Name, const std::string& Text) override;
	virtual void RemoveFile(const std::string& Name) override;
	virtual bool HasFile(const std::string& Name) override;
	virtual void PlaySfx(const std::string& Name) override;
	virtual void PlayMusic(const std::string& Name) override;
	virtual void ApplyVolume(int MusicLevel, int SfxLevel) override;
	virtual void SetFullscreen(bool bOn) override;
	virtual void Print(const std::string& Line) override;
	virtual void Quit() override;
	virtual int64_t NowSeed() override;

	static FString SaveDir();

private:
	FString PathOf(const std::string& Name) const;
	AHBGameMode* Owner;
};

struct FHBRuntime
{
	explicit FHBRuntime(AHBGameMode* Owner) : Host(Owner) {}

	FHBHost Host;
	hb::app::App App;
	std::map<std::string, hb::app::Wav> Sounds;
};
