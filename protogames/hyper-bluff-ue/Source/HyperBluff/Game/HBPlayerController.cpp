#include "HBPlayerController.h"

#include <string>

#include "Engine/World.h"
#include "InputCoreTypes.h"

#include "HBGameMode.h"
#include "HBRuntime.h"

AHBPlayerController::AHBPlayerController()
{
	bShowMouseCursor = true;
}

void AHBPlayerController::BeginPlay()
{
	Super::BeginPlay();
	bShowMouseCursor = true;
	FInputModeGameAndUI Mode;
	Mode.SetLockMouseToViewportBehavior(EMouseLockMode::DoNotLock);
	Mode.SetHideCursorDuringCapture(false);
	SetInputMode(Mode);
	for (const std::string& Name : hb::app::AllKeyNames())
	{
		const FString KeyName(UTF8_TO_TCHAR(Name.c_str()));
		KeyNames.Add(KeyName);
		Keys.Add(FKey(FName(*KeyName)));
	}
}

void AHBPlayerController::PlayerTick(float DeltaTime)
{
	Super::PlayerTick(DeltaTime);
	UWorld* World = GetWorld();
	AHBGameMode* GameMode = World ? World->GetAuthGameMode<AHBGameMode>() : nullptr;
	FHBRuntime* Runtime = GameMode ? GameMode->GetRuntime() : nullptr;
	if (Runtime == nullptr)
	{
		return;
	}
	hb::app::App& App = Runtime->App;

	// Keyboard and pad: every press goes to the app on the frame it happens (no OS repeat;
	// the app repeats held directions itself and swallows keys held across screens).
	for (int32 i = 0; i < Keys.Num(); ++i)
	{
		if (WasInputKeyJustPressed(Keys[i]))
		{
			App.KeyDown(std::string(TCHAR_TO_UTF8(*KeyNames[i])));
		}
		if (WasInputKeyJustReleased(Keys[i]))
		{
			App.KeyUp(std::string(TCHAR_TO_UTF8(*KeyNames[i])));
		}
	}

	// Mouse: viewport pixels -> the 640x360 virtual screen.
	float MouseX = 0.0f;
	float MouseY = 0.0f;
	if (!GetMousePosition(MouseX, MouseY))
	{
		return;
	}
	hb::app::Layout L;
	GameMode->GetLayout(L.scale, L.off_x, L.off_y);
	hb::app::Vec2 V;
	const bool bInside = hb::app::ToVirtual(L, MouseX, MouseY, V);
	if (bInside && (MouseX != LastMouse.X || MouseY != LastMouse.Y))
	{
		App.MouseMove(V);
	}
	LastMouse = FVector2D(MouseX, MouseY);
	if (bInside && WasInputKeyJustPressed(EKeys::LeftMouseButton))
	{
		App.MouseClick(V);
	}
	if (WasInputKeyJustPressed(EKeys::MouseScrollUp))
	{
		App.MouseWheel(1);
	}
	if (WasInputKeyJustPressed(EKeys::MouseScrollDown))
	{
		App.MouseWheel(-1);
	}
}
