#include "HBGameMode.h"

#include <cstdio>

#include "Components/AudioComponent.h"
#include "Engine/Engine.h"
#include "Engine/Texture2D.h"
#include "Engine/World.h"
#include "GameFramework/GameUserSettings.h"
#include "GameFramework/PlayerController.h"
#include "HAL/FileManager.h"
#include "HAL/PlatformMisc.h"
#include "HAL/PlatformTime.h"
#include "Kismet/KismetSystemLibrary.h"
#include "Misc/CommandLine.h"
#include "Misc/DateTime.h"
#include "Misc/FileHelper.h"
#include "Misc/Parse.h"
#include "Misc/Paths.h"
#include "Sound/SoundWaveProcedural.h"
#include "TextureResource.h"

#include "HBHUD.h"
#include "HBPlayerController.h"
#include "HBRuntime.h"
#include "HyperBluff.h"

#ifndef INDEFINITELY_LOOPING_DURATION
#define INDEFINITELY_LOOPING_DURATION 10000.0f
#endif

namespace
{
FString ToFString(const std::string& Text) { return FString(UTF8_TO_TCHAR(Text.c_str())); }
std::string ToStd(const FString& Text) { return std::string(TCHAR_TO_UTF8(*Text)); }

FString RawDir(const TCHAR* Sub) { return FPaths::Combine(FPaths::ProjectContentDir(), TEXT("Raw"), Sub); }

const TCHAR* const GSoundNames[] = {
	TEXT("allin"), TEXT("boss"), TEXT("cancel"), TEXT("card_deal"), TEXT("card_flip"), TEXT("check"),
	TEXT("chip_bet"), TEXT("chip_win"), TEXT("cutin"), TEXT("defeat"), TEXT("ending"), TEXT("error"),
	TEXT("fever"), TEXT("fold"), TEXT("lose_hand"), TEXT("match"), TEXT("meter_tick"), TEXT("move"),
	TEXT("ok"), TEXT("powerup"), TEXT("roulette_tick"), TEXT("star"), TEXT("title"), TEXT("type"),
	TEXT("victory"), TEXT("win_hand")};

// audio.gd LOOPS: these tracks loop, victory and defeat play once.
bool IsLoopingTrack(const FString& Name)
{
	return Name == TEXT("title") || Name == TEXT("match") || Name == TEXT("boss") || Name == TEXT("fever") ||
		Name == TEXT("ending");
}

constexpr int32 GSfxVoices = 8;
}  // namespace

// ---- FHBHost -------------------------------------------------------------------------------

FString FHBHost::SaveDir() { return FPaths::Combine(FPaths::ProjectSavedDir(), TEXT("HyperBluff")); }

FString FHBHost::PathOf(const std::string& Name) const { return FPaths::Combine(SaveDir(), ToFString(Name)); }

bool FHBHost::ReadText(const std::string& Name, std::string& Out)
{
	FString Text;
	if (!FFileHelper::LoadFileToString(Text, *PathOf(Name)))
	{
		return false;
	}
	Out = ToStd(Text);
	return true;
}

bool FHBHost::WriteText(const std::string& Name, const std::string& Text)
{
	const FString Path = PathOf(Name);
	IFileManager::Get().MakeDirectory(*FPaths::GetPath(Path), true);
	return FFileHelper::SaveStringToFile(ToFString(Text), *Path);
}

void FHBHost::RemoveFile(const std::string& Name)
{
	const FString Path = PathOf(Name);
	if (FPaths::FileExists(Path))
	{
		IFileManager::Get().Delete(*Path);
	}
}

bool FHBHost::HasFile(const std::string& Name) { return FPaths::FileExists(PathOf(Name)); }

void FHBHost::PlaySfx(const std::string& Name) { Owner->HostPlaySfx(ToFString(Name)); }

void FHBHost::PlayMusic(const std::string& Name) { Owner->HostPlayMusic(ToFString(Name)); }

void FHBHost::ApplyVolume(int MusicLevel, int SfxLevel) { Owner->HostApplyVolume(MusicLevel, SfxLevel); }

void FHBHost::SetFullscreen(bool bOn)
{
	UGameUserSettings* Settings = GEngine ? GEngine->GetGameUserSettings() : nullptr;
	if (Settings == nullptr || GIsEditor)
	{
		return;
	}
	Settings->SetFullscreenMode(bOn ? EWindowMode::WindowedFullscreen : EWindowMode::Windowed);
	Settings->ApplyResolutionSettings(false);
}

void FHBHost::Print(const std::string& Line)
{
	const FString Text = ToFString(Line);
	UE_LOG(LogHB, Display, TEXT("%s"), *Text);
	// Also plain on stdout, so "UnrealEditor-Cmd ... -stdout" shows lines starting with "DUMP ".
	std::printf("%s\n", Line.c_str());
	std::fflush(stdout);
}

void FHBHost::Quit() { Owner->HostQuit(); }

int64_t FHBHost::NowSeed()
{
	return static_cast<int64_t>(FDateTime::Now().GetTicks()) ^ static_cast<int64_t>(FPlatformTime::Cycles64() << 8);
}

// ---- AHBGameMode ---------------------------------------------------------------------------

AHBGameMode::AHBGameMode()
{
	HUDClass = AHBHUD::StaticClass();
	PlayerControllerClass = AHBPlayerController::StaticClass();
	DefaultPawnClass = nullptr;
	PrimaryActorTick.bCanEverTick = true;
	PrimaryActorTick.bStartWithTickEnabled = true;
}

void AHBGameMode::BeginPlay()
{
	Super::BeginPlay();
	IFileManager::Get().MakeDirectory(*FPaths::Combine(FHBHost::SaveDir(), TEXT("harness")), true);

	Runtime = new FHBRuntime(this);
	for (int32 i = 0; i < GSfxVoices; ++i)
	{
		SfxPool.Add(MakeAudioComponent());
	}
	MusicComponent = MakeAudioComponent();
	LoadArt();
	LoadAudio();

	// -HBScript="cmd,cmd,..." runs the harness (same commands as the Godot build).
	FString Script;
	const bool bHarness = FParse::Value(FCommandLine::Get(), TEXT("HBScript="), Script, false);
	if (bHarness)
	{
		UE_LOG(LogHB, Display, TEXT("Harness script: %s"), *Script);
	}
	Runtime->App.Init(&Runtime->Host, bHarness, ToStd(Script));
	for (int32 i = 0; i < TextureSizes.Num(); ++i)
	{
		Runtime->App.SetTextureSize(static_cast<hb::app::Tex>(i), TextureSizes[i].X, TextureSizes[i].Y);
	}
	FString Portraits;
	FString Sheets;
	FFileHelper::LoadFileToString(Portraits, *FPaths::Combine(RawDir(TEXT("Art")), TEXT("portraits.json")));
	FFileHelper::LoadFileToString(Sheets, *FPaths::Combine(RawDir(TEXT("Art")), TEXT("sheets.json")));
	Runtime->App.SetArtMeta(ToStd(Portraits), ToStd(Sheets));
}

void AHBGameMode::EndPlay(const EEndPlayReason::Type EndPlayReason)
{
	delete Runtime;
	Runtime = nullptr;
	Super::EndPlay(EndPlayReason);
}

void AHBGameMode::BeginDestroy()
{
	delete Runtime;
	Runtime = nullptr;
	Super::BeginDestroy();
}

void AHBGameMode::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	if (Runtime == nullptr || bQuitRequested)
	{
		return;
	}
	Runtime->App.Frame(static_cast<double>(DeltaSeconds));
	RefillMusic();
}

UTexture2D* AHBGameMode::GetTex(int32 Index) const
{
	return Textures.IsValidIndex(Index) ? Textures[Index].Get() : nullptr;
}

FIntPoint AHBGameMode::GetTexSize(int32 Index) const
{
	return TextureSizes.IsValidIndex(Index) ? TextureSizes[Index] : FIntPoint(1, 1);
}

void AHBGameMode::SetLayout(int32 Scale, int32 OffX, int32 OffY)
{
	LayoutScale = Scale;
	LayoutOffX = OffX;
	LayoutOffY = OffY;
}

void AHBGameMode::GetLayout(int32& Scale, int32& OffX, int32& OffY) const
{
	Scale = LayoutScale;
	OffX = LayoutOffX;
	OffY = LayoutOffY;
}

// PNG files are decoded by the app layer's own decoder (tested on Linux against PIL) and
// copied into transient BGRA8 textures with nearest filtering.
void AHBGameMode::LoadArt()
{
	Textures.SetNum(hb::app::kTexCount);
	TextureSizes.SetNum(hb::app::kTexCount);
	for (int32 i = 0; i < hb::app::kTexCount; ++i)
	{
		Textures[i] = nullptr;
		TextureSizes[i] = FIntPoint(1, 1);
		const FString Path = FPaths::Combine(RawDir(TEXT("Art")), FString(UTF8_TO_TCHAR(hb::app::TexFile(static_cast<hb::app::Tex>(i)))));
		TArray<uint8> Bytes;
		if (!FFileHelper::LoadFileToArray(Bytes, *Path))
		{
			UE_LOG(LogHB, Error, TEXT("Missing image %s"), *Path);
			continue;
		}
		hb::app::Image Img;
		std::string Error;
		if (!hb::app::DecodePng(Bytes.GetData(), static_cast<size_t>(Bytes.Num()), Img, Error))
		{
			UE_LOG(LogHB, Error, TEXT("Cannot decode %s: %s"), *Path, *ToFString(Error));
			continue;
		}
		UTexture2D* Tex = UTexture2D::CreateTransient(Img.w, Img.h, PF_B8G8R8A8);
		if (Tex == nullptr)
		{
			continue;
		}
		Tex->Filter = TF_Nearest;
		Tex->SRGB = true;
		Tex->LODGroup = TEXTUREGROUP_Pixels2D;
		Tex->NeverStream = true;
		FTexturePlatformData* Platform = Tex->GetPlatformData();
		if (Platform == nullptr || Platform->Mips.Num() == 0)
		{
			continue;
		}
		FTexture2DMipMap& Mip = Platform->Mips[0];
		void* Dest = Mip.BulkData.Lock(LOCK_READ_WRITE);
		FMemory::Memcpy(Dest, Img.bgra.data(), Img.bgra.size());
		Mip.BulkData.Unlock();
		Tex->UpdateResource();
		Textures[i] = Tex;
		TextureSizes[i] = FIntPoint(Img.w, Img.h);
	}
}

void AHBGameMode::LoadAudio()
{
	for (const TCHAR* Name : GSoundNames)
	{
		const FString Path = FPaths::Combine(RawDir(TEXT("Audio")), FString(Name) + TEXT(".wav"));
		TArray<uint8> Bytes;
		if (!FFileHelper::LoadFileToArray(Bytes, *Path))
		{
			UE_LOG(LogHB, Warning, TEXT("Missing sound %s"), *Path);
			continue;
		}
		hb::app::Wav Wave;
		std::string Error;
		if (!hb::app::DecodeWav(Bytes.GetData(), static_cast<size_t>(Bytes.Num()), Wave, Error))
		{
			UE_LOG(LogHB, Warning, TEXT("Cannot decode %s: %s"), *Path, *ToFString(Error));
			continue;
		}
		Runtime->Sounds[ToStd(FString(Name))] = MoveTemp(Wave);
	}
}

UAudioComponent* AHBGameMode::MakeAudioComponent()
{
	UAudioComponent* Comp = NewObject<UAudioComponent>(this);
	Comp->bAutoActivate = false;
	Comp->bAllowSpatialization = false;
	Comp->bIsUISound = true;
	Comp->RegisterComponent();
	return Comp;
}

// A fresh procedural wave per play: the 16-bit PCM is queued whole.
static USoundWaveProcedural* MakeWave(UObject* Outer, const hb::app::Wav& Wave)
{
	USoundWaveProcedural* Proc = NewObject<USoundWaveProcedural>(Outer);
	Proc->SetSampleRate(static_cast<uint32>(Wave.sample_rate));
	Proc->NumChannels = Wave.channels;
	Proc->Duration = INDEFINITELY_LOOPING_DURATION;
	Proc->SoundGroup = SOUNDGROUP_Default;
	Proc->bLooping = false;
	Proc->QueueAudio(Wave.pcm.data(), static_cast<int32>(Wave.pcm.size()));
	return Proc;
}

void AHBGameMode::HostPlaySfx(const FString& Name)
{
	if (Runtime == nullptr || SfxPool.Num() == 0)
	{
		return;
	}
	const auto Found = Runtime->Sounds.find(ToStd(Name));
	if (Found == Runtime->Sounds.end())
	{
		return;
	}
	UAudioComponent* Comp = SfxPool[NextSfx];
	NextSfx = (NextSfx + 1) % SfxPool.Num();
	if (Comp == nullptr)
	{
		return;
	}
	Comp->Stop();
	Comp->SetSound(MakeWave(this, Found->second));
	Comp->SetVolumeMultiplier(SfxVolume);
	Comp->Play();
}

void AHBGameMode::HostPlayMusic(const FString& Name)
{
	MusicName = Name;
	bMusicLoops = IsLoopingTrack(Name);
	if (MusicComponent == nullptr || Runtime == nullptr)
	{
		return;
	}
	MusicComponent->Stop();
	MusicWave = nullptr;
	const auto Found = Runtime->Sounds.find(ToStd(Name));
	if (Found == Runtime->Sounds.end())
	{
		return;
	}
	MusicWave = MakeWave(this, Found->second);
	MusicComponent->SetSound(MusicWave);
	MusicComponent->SetVolumeMultiplier(MusicVolume);
	MusicComponent->Play();
}

// Looping music: queue the whole track again when less than a second is left.
void AHBGameMode::RefillMusic()
{
	if (!bMusicLoops || MusicWave == nullptr || Runtime == nullptr)
	{
		return;
	}
	const auto Found = Runtime->Sounds.find(ToStd(MusicName));
	if (Found == Runtime->Sounds.end())
	{
		return;
	}
	const hb::app::Wav& Wave = Found->second;
	const int32 OneSecond = Wave.sample_rate * Wave.channels * 2;
	if (MusicWave->GetAvailableAudioByteCount() < OneSecond)
	{
		MusicWave->QueueAudio(Wave.pcm.data(), static_cast<int32>(Wave.pcm.size()));
	}
}

// audio.gd: linear_to_db(v / 10), music 4 dB lower (x 0.631).
void AHBGameMode::HostApplyVolume(int32 Music, int32 Sfx)
{
	SfxVolume = FMath::Clamp(Sfx, 0, 10) / 10.0f;
	MusicVolume = FMath::Clamp(Music, 0, 10) / 10.0f * 0.631f;
	if (MusicComponent != nullptr)
	{
		MusicComponent->SetVolumeMultiplier(MusicVolume);
	}
}

void AHBGameMode::HostQuit()
{
	if (bQuitRequested)
	{
		return;
	}
	bQuitRequested = true;
	if (GIsEditor)
	{
		// Play-in-editor: end the session, not the editor.
		APlayerController* PC = GetWorld() ? GetWorld()->GetFirstPlayerController() : nullptr;
		UKismetSystemLibrary::QuitGame(this, PC, EQuitPreference::Quit, false);
		return;
	}
	FPlatformMisc::RequestExit(false);
}
