//! {{description}}
#![forbid(unsafe_code)]

/// Adds two numbers.
///
/// ```
/// assert_eq!({{crate}}::add(2, 3), 5);
/// ```
#[must_use]
pub fn add(a: u32, b: u32) -> u32 {
    a + b
}

#[cfg(test)]
mod tests {
    use super::add;

    #[test]
    fn adds_two_numbers() {
        assert_eq!(add(2, 3), 5);
    }
}
