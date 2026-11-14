using System.IO;
using UnrealBuildTool;

public class HyperBluff : ModuleRules
{
	public HyperBluff(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
		CppStandard = CppStandardVersion.Cpp20;
		PublicIncludePaths.Add(ModuleDirectory);
		// Core/ (poker rules) and App/ (screens, input, drawing, harness) are plain C++ shared
		// with the Linux test runners in tests/. They include each other by bare file name.
		PrivateIncludePaths.Add(Path.Combine(ModuleDirectory, "Core"));
		PrivateIncludePaths.Add(Path.Combine(ModuleDirectory, "App"));
		PublicDependencyModuleNames.AddRange(new string[] {
			"Core", "CoreUObject", "Engine", "InputCore", "Slate", "SlateCore",
			"ImageWrapper", "AudioMixer"
		});
		bEnableExceptions = false;
		// Each plain C++ file has file-local helpers; build them as separate files, never
		// glued into one unity file.
		bUseUnity = false;
	}
}
