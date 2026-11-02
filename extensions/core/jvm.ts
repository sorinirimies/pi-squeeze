/**
 * What the JVM and its usual libraries print on every run of Gradle, Maven or a test JVM,
 * and that says nothing about the build: class-data sharing, dynamic agents (Mockito,
 * ByteBuddy), SLF4J without a binding.
 */
export const JVM_NOISE = [
	/^OpenJDK 64-Bit Server VM warning: Sharing is only supported/,
	/^WARNING: A Java agent has been loaded dynamically/,
	/^WARNING: If a serviceability tool is (?:not )?in use/,
	/^WARNING: Dynamic loading of agents will be disallowed/,
	/^WARNING: A terminally deprecated method in sun\.misc\.Unsafe/,
	/^WARNING: sun\.misc\.Unsafe::\w+ (?:has been called|will be removed)/,
	/^WARNING: Please consider reporting this to the maintainers/,
	/^Mockito is currently self-attaching to enable the inline-mock-maker/,
	/^SLF4J(?:\(\w\))?: (?:No SLF4J providers|Defaulting to no-operation|See https?:\/\/www\.slf4j\.org|Failed to load class|Class path contains multiple)/,
];

export const isJvmNoise = (line: string): boolean => JVM_NOISE.some((n) => n.test(line));
