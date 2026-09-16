{
  boost,
  lib,
  stdenv,
}:
stdenv.mkDerivation {
  pname = "logcat-colorize";
  version = "0.9.0";
  src = ../bin/logcat-colorize-0.9.0;

  buildInputs = [ boost ];

  buildPhase = ''
    runHook preBuild
    $CXX logcat-colorize.cpp -o logcat-colorize \
      -std=c++11 -O3 -Wno-deprecated-register \
      -I${lib.getDev boost}/include \
      -L${lib.getLib boost}/lib \
      -lboost_regex -lboost_program_options
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
    install -Dm755 logcat-colorize $out/bin/logcat-colorize
    runHook postInstall
  '';

  meta = {
    description = "Colorized Android logcat output";
    license = lib.licenses.asl20;
    mainProgram = "logcat-colorize";
    platforms = lib.platforms.unix;
  };
}
