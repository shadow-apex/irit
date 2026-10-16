Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
batPath = scriptDir & "\launch-iris.bat"
WshShell.Run "cmd.exe /c """ & batPath & """", 0, False
