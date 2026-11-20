package apps

import "testing"

const sample = "   - \r   \\ \r                                                     \r" +
	"Name                               Id                           Version        Available      Source\r\n" +
	"---------------------------------------------------------------------------------------------------\r\n" +
	"Microsoft Edge                     Microsoft.Edge               119.0.2151.72  120.0.2210.61  winget\r\n" +
	"7-Zip 22.01 (x64)                  7zip.7zip                    22.01          23.01          winget\r\n" +
	"微信                               Tencent.WeChat               3.9.0          3.9.8          winget\r\n" +
	"Some Very Long Application Name…   Vendor.SomeVeryLongApplicati… 1.0            2.0            winget\r\n" +
	"4 upgrades available.\r\n" +
	"\r\n" +
	"The following packages have an upgrade available, but require explicit targeting for upgrade:\r\n" +
	"Name   Id         Version  Available Source\r\n" +
	"-------------------------------------------\r\n" +
	"Pinned Pin.Ned    1.0      2.0       winget\r\n"

func TestParse(t *testing.T) {
	ups := Parse(sample)
	if len(ups) != 4 {
		t.Fatalf("got %d: %+v", len(ups), ups)
	}
	if u := ups[0]; u.Name != "Microsoft Edge" || u.ID != "Microsoft.Edge" || u.Version != "119.0.2151.72" || u.Available != "120.0.2210.61" || u.Source != "winget" {
		t.Fatalf("edge %+v", u)
	}
	if u := ups[1]; u.Name != "7-Zip 22.01 (x64)" || u.ID != "7zip.7zip" {
		t.Fatalf("7zip %+v", u)
	}
	if u := ups[2]; u.Name != "微信" || u.ID != "Tencent.WeChat" || u.Available != "3.9.8" {
		t.Fatalf("wide characters %+v", u)
	}
	if !ups[3].Truncated || ups[0].Truncated {
		t.Fatal("truncated id not flagged")
	}
}

func TestParseOtherLanguageAndEmpty(t *testing.T) {
	de := "Name        ID              Version  Verfügbar  Quelle\n" +
		"------------------------------------------------------\n" +
		"Git         Git.Git         2.42.0   2.43.0     winget\n" +
		"1 Aktualisierungen verfügbar.\n"
	if ups := Parse(de); len(ups) != 1 || ups[0].ID != "Git.Git" || ups[0].Available != "2.43.0" {
		t.Fatalf("german %+v", ups)
	}
	if ups := Parse("No installed package found matching input criteria.\n"); len(ups) != 0 {
		t.Fatal("phantom updates")
	}
}

func TestValidID(t *testing.T) {
	for _, ok := range []string{"Microsoft.Edge", "7zip.7zip", "Notepad++.Notepad++", "Git.Git"} {
		if !ValidID(ok) {
			t.Errorf("%s rejected", ok)
		}
	}
	for _, bad := range []string{"", "--force", "a b", "x;rm", "Vendor.Name…"} {
		if ValidID(bad) {
			t.Errorf("%q accepted", bad)
		}
	}
}
