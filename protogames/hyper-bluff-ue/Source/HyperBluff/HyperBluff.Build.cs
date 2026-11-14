using UnrealBuildTool;

public class HyperBluff : ModuleRules
{
	public HyperBluff(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
		CppStandard = CppStandardVersion.Cpp20;
		PublicIncludePaths.Add(ModuleDirectory);
		PrivateIncludePaths.Add(System.IO.Path.Combine(ModuleDirectory, "Core"));
		PublicDependencyModuleNames.AddRange(new string[] {
			"Core", "CoreUObject", "Engine", "InputCore", "Slate", "SlateCore",
			"ImageWrapper", "AudioMixer"
		});
		// The poker rules in Core/ are plain C++ shared with the Linux test runner.
		bEnableExceptions = false;
	}
}
