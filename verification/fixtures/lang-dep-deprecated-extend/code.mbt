priv trait ReleaseLegacyName {
  legacy_name(Self) -> String
}

priv struct ReleaseDeprecatedRobot {
  name : String
}

impl ReleaseLegacyName for ReleaseDeprecatedRobot with legacy_name(self) {
  self.name
}

#deprecated("Call ReleaseLegacyName::legacy_name explicitly")
extend ReleaseDeprecatedRobot with ReleaseLegacyName::{legacy_name}

test "deprecated extend dot call" {
  let robot : ReleaseDeprecatedRobot = { name: "robot" }
  assert_eq(robot.legacy_name(), "robot")
}
