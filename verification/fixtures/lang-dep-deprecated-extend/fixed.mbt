priv trait ReleaseLegacyName {
  legacy_name(Self) -> String
}

priv struct ReleaseDeprecatedRobot {
  name : String
}

impl ReleaseLegacyName for ReleaseDeprecatedRobot with legacy_name(self) {
  self.name
}

test "qualified call replaces deprecated method attachment" {
  let robot : ReleaseDeprecatedRobot = { name: "robot" }
  assert_eq(ReleaseLegacyName::legacy_name(robot), "robot")
}
