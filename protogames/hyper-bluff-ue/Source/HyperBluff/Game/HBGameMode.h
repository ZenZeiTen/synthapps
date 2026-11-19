// The game mode owns the app (Source/HyperBluff/App, plain C++), ticks it at a fixed 60 Hz,
// loads the art and sound from Content/Raw/, and is the app's Host: files, sounds, quit.
// The empty Entry map has no pawn; AHBHUD draws everything.
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/GameModeBase.h"

#include "HBGameMode.generated.h"

class UTexture2D;
class UAudioComponent;
class USoundWaveProcedural;
struct FHBRuntime;  // Game/HBRuntime.h: the plain C++ app and its host (kept out of this UHT header)

UCLASS()
class HYPERBLUFF_API AHBGameMode : public AGameModeBase
{
	GENERATED_BODY()

public:
	AHBGameMode();

	virtual void BeginPlay() override;
	virtual void EndPlay(const EEndPlayReason::Type EndPlayReason) override;
	virtual void BeginDestroy() override;
	virtual void Tick(float DeltaSeconds) override;

	/** The app and its host (see HBRuntime.h), or nullptr before BeginPlay. */
	FHBRuntime* GetRuntime() const { return Runtime; }
	/** Texture for hb::app::Tex index, or nullptr if it failed to load. */
	UTexture2D* GetTex(int32 Index) const;
	FIntPoint GetTexSize(int32 Index) const;
	/** Letterbox of the last drawn frame (the HUD sets it; the controller maps the mouse with it). */
	void SetLayout(int32 Scale, int32 OffX, int32 OffY);
	void GetLayout(int32& Scale, int32& OffX, int32& OffY) const;

	// Host services, called by the app through FHBHost (HBGameMode.cpp).
	void HostPlaySfx(const FString& Name);
	void HostPlayMusic(const FString& Name);
	void HostApplyVolume(int32 Music, int32 Sfx);
	void HostQuit();

private:
	void LoadArt();
	void LoadAudio();
	UAudioComponent* MakeAudioComponent();
	void RefillMusic();

	UPROPERTY(Transient)
	TArray<TObjectPtr<UTexture2D>> Textures;

	UPROPERTY(Transient)
	TArray<TObjectPtr<UAudioComponent>> SfxPool;

	UPROPERTY(Transient)
	TObjectPtr<UAudioComponent> MusicComponent;

	UPROPERTY(Transient)
	TObjectPtr<USoundWaveProcedural> MusicWave;

	TArray<FIntPoint> TextureSizes;
	FString MusicName;
	bool bMusicLoops = false;
	int32 NextSfx = 0;
	float SfxVolume = 0.8f;
	float MusicVolume = 0.7f;
	int32 LayoutScale = 1;
	int32 LayoutOffX = 0;
	int32 LayoutOffY = 0;
	bool bQuitRequested = false;

	/** Plain C++ side: the app, its host and the decoded sounds. Owned; deleted in EndPlay/BeginDestroy. */
	FHBRuntime* Runtime = nullptr;
};
