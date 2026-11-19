// Shows the mouse cursor and forwards keys, pad buttons, mouse moves, clicks and the wheel to
// the app (keys by their Unreal names; the app maps them to actions exactly like main.gd).
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/PlayerController.h"
#include "InputCoreTypes.h"

#include "HBPlayerController.generated.h"

UCLASS()
class HYPERBLUFF_API AHBPlayerController : public APlayerController
{
	GENERATED_BODY()

public:
	AHBPlayerController();

	virtual void BeginPlay() override;
	virtual void PlayerTick(float DeltaTime) override;

private:
	TArray<FKey> Keys;
	TArray<FString> KeyNames;
	FVector2D LastMouse = FVector2D(-1.0, -1.0);
};
