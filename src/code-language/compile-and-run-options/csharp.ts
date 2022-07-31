import { IsIn } from "class-validator";

export default class CompileAndRunOptionsCSharp {
  @IsIn(["7.3", "8", "9"])
  version: string;
}
