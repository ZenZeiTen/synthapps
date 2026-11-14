using UnrealBuildTool;

public class HyperBluffTarget : TargetRules
{
	public HyperBluffTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Game;
		DefaultBuildSettings = BuildSettingsVersion.Latest;
		IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
		ExtraModuleNames.Add("HyperBluff");
	}
}
