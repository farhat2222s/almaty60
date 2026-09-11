using UnrealBuildTool;

public class AL60 : ModuleRules
{
    public AL60(ReadOnlyTargetRules Target) : base(Target)
    {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

        PublicDependencyModuleNames.AddRange(new string[]
        {
            "Core",
            "CoreUObject",
            "Engine",
            "InputCore",
            "EnhancedInput",
            "AIModule",
            "AssetRegistry",
            "HTTP",
            "Json",
            "JsonUtilities",
            "UMG",
            "Slate",
            "SlateCore"
        });
    }
}
