#include "HBHUD.h"

#include "Engine/Canvas.h"
#include "Engine/Texture2D.h"
#include "Engine/World.h"

#include "HBGameMode.h"
#include "HBRuntime.h"

namespace
{
// The app's colours are sRGB like Godot's; the canvas blends in linear space.
FLinearColor ToLinear(const hb::app::Color& C)
{
	auto Byte = [](float V) { return static_cast<uint8>(FMath::Clamp(FMath::RoundToInt(V * 255.0f), 0, 255)); };
	return FLinearColor(FColor(Byte(C.r), Byte(C.g), Byte(C.b), Byte(C.a)));
}
}  // namespace

void AHBHUD::DrawHUD()
{
	Super::DrawHUD();
	UWorld* World = GetWorld();
	AHBGameMode* Mode = World ? World->GetAuthGameMode<AHBGameMode>() : nullptr;
	FHBRuntime* Runtime = Mode ? Mode->GetRuntime() : nullptr;
	if (Canvas == nullptr || Runtime == nullptr)
	{
		return;
	}
	const hb::app::Layout L = hb::app::ComputeLayout(FMath::TruncToInt(Canvas->ClipX), FMath::TruncToInt(Canvas->ClipY));
	Mode->SetLayout(L.scale, L.off_x, L.off_y);
	DrawRect(FLinearColor(FColor(6, 5, 10, 255)), 0.0f, 0.0f, Canvas->ClipX, Canvas->ClipY);

	const float S = static_cast<float>(L.scale);
	const float OX = static_cast<float>(L.off_x);
	const float OY = static_cast<float>(L.off_y);
	for (const hb::app::DrawCmd& C : Runtime->App.Render())
	{
		const float X = OX + C.x * S;
		const float Y = OY + C.y * S;
		const float W = C.w * S;
		const float H = C.h * S;
		if (W <= 0.0f || H <= 0.0f)
		{
			continue;
		}
		if (C.tex < 0)
		{
			DrawRect(ToLinear(C.col), X, Y, W, H);
			continue;
		}
		UTexture2D* Tex = Mode->GetTex(C.tex);
		if (Tex == nullptr)
		{
			continue;
		}
		const FIntPoint Size = Mode->GetTexSize(C.tex);
		const float TW = static_cast<float>(Size.X);
		const float TH = static_cast<float>(Size.Y);
		DrawTexture(Tex, X, Y, W, H, C.u / TW, C.v / TH, C.uw / TW, C.vh / TH, ToLinear(C.col), BLEND_Translucent);
	}
}
