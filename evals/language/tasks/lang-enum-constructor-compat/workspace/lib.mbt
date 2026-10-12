///|
pub(all) enum Source {
  File(String)
  Package(String)
} derive(Eq, Debug)

///|
pub extend Source with Eq::{not_equal, equal}

///|
pub extend Source with @debug.Debug::{to_repr}

///|
pub fn classify(source : Source) -> String {
  match source {
    File(path) => "file:\{path}"
    Package(name) => "package:\{name}"
  }
}
