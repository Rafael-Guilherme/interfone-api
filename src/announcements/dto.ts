import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateAnnouncementDto {
  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsString()
  @IsNotEmpty()
  body!: string;

  @IsOptional()
  @IsIn(['all', 'block'])
  scope?: 'all' | 'block';

  @IsOptional()
  @IsString()
  block_id?: string;
}
