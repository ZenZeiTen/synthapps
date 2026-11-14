using UnrealBuildTool;

public class HyperBluffEditorTarget : TargetRules
{
	public HyperBluffEditorTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Editor;
		DefaultBuildSettings = BuildSettingsVersion.Latest;
		IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
		ExtraModuleNames.Add("HyperBluff");
	}
}
