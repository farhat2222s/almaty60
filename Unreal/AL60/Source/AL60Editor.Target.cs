using UnrealBuildTool;

public class AL60EditorTarget : TargetRules
{
    public AL60EditorTarget(TargetInfo Target) : base(Target)
    {
        Type = TargetType.Editor;
        DefaultBuildSettings = BuildSettingsVersion.V5;
        IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
        ExtraModuleNames.Add("AL60");
    }
}
