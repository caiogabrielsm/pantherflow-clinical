Dim WshShell, ProjectDir, ElectronExe

Set WshShell = CreateObject("WScript.Shell")

' Detecta automaticamente o diretório onde este arquivo está
ProjectDir = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))

ElectronExe = ProjectDir & "node_modules\electron\dist\electron.exe"

WshShell.CurrentDirectory = ProjectDir

' WindowStyle = 0 → sem janela de terminal visível
WshShell.Run """" & ElectronExe & """ """ & ProjectDir & """", 0, False
