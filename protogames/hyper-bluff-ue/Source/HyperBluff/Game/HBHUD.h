// Draws the app's 640x360 draw list onto the canvas, scaled by the largest integer that fits,
// centred and letterboxed in near-black.
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/HUD.h"

#include "HBHUD.generated.h"

UCLASS()
class HYPERBLUFF_API AHBHUD : public AHUD
{
	GENERATED_BODY()

public:
	virtual void DrawHUD() override;
};
